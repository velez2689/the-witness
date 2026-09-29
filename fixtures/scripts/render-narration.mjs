// Render docs/submission/narration.md with the AssemblyAI Voice Agent API, the way the product
// speaks: the first line of a session is the greeting, every other line goes out as reply.create
// with "say exactly the following", and the audio that comes back is saved one WAV per line.
//
//   node --env-file=.env fixtures/scripts/render-narration.mjs [outDir]
//
// Speakers. A numbered line is one or more segments separated by " || ". A segment that starts
// with "REP: " is the payer representative and is rendered with a second voice (REP_VOICE, default
// george) and run through a phone-line filter; every other segment is the narrator (WITNESS_VOICE,
// default jean). Line numbers never change, because the footage script ties one console step to
// each number.
//
// Optional environment:
//   ONLY_LINES=12,18,20   render just those lines and merge them into the existing index.json
//   FFMPEG=<path>         ffmpeg for the phone filter (default: ffmpeg on the PATH)
//
// Needs ASSEMBLYAI_API_KEY in the environment (never printed). Writes <outDir>/NN.wav (24 kHz
// mono PCM16) and <outDir>/index.json with each line's caption text and duration, which the
// footage script and the mux step read. Each session is closed with session.end.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) {
  console.error('ASSEMBLYAI_API_KEY is not set');
  process.exit(1);
}
const out = process.argv[2] ?? 'docs/assets/narration';
mkdirSync(out, { recursive: true });

const NARRATOR_VOICE = process.env.WITNESS_VOICE ?? 'jean';
const REP_VOICE = process.env.REP_VOICE ?? 'george';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const only = process.env.ONLY_LINES ? new Set(process.env.ONLY_LINES.split(',').map(Number)) : null;
const SAMPLE_RATE = 24_000;
const GAP_SECONDS = 0.3;

const lines = readFileSync('docs/submission/narration.md', 'utf8')
  .split(/\r?\n/)
  .map((l) => /^(\d+)\.\s+(.*)$/.exec(l))
  .filter(Boolean)
  .map((m) => {
    const segments = m[2].split(' || ').map((s) => {
      const t = s.trim();
      return t.startsWith('REP: ') ? { who: 'rep', text: t.slice(5).trim() } : { who: 'narrator', text: t };
    });
    return { n: Number(m[1]), segments, caption: segments.map((s) => s.text).join(' ') };
  });
if (lines.length === 0) throw new Error('no numbered lines found in narration.md');
const wanted = lines.filter((l) => !only || only.has(l.n));

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function pcmOf(buf) {
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size;
  }
  throw new Error('no data chunk');
}

/** A payer line: narrow the band to a telephone's and squash the dynamics a little. */
function phoneLine(pcm) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'phone-'));
  try {
    const src = path.join(dir, 'in.wav');
    const dst = path.join(dir, 'out.wav');
    writeFileSync(src, wav(pcm));
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-af',
      'highpass=f=320,lowpass=f=3200,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=1.4',
      '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', dst]);
    return Buffer.from(pcmOf(readFileSync(dst)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One Voice Agent session in one voice: jobs is [{ id, text }]; resolves to Map(id -> PCM). */
async function renderSession(voice, jobs) {
  const audio = new Map();
  if (jobs.length === 0) return audio;
  const tokenUrl = new URL('https://agents.assemblyai.com/v1/token');
  tokenUrl.searchParams.set('expires_in_seconds', '60');
  tokenUrl.searchParams.set('max_session_duration_seconds', '600');
  const tr = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${key}` } });
  if (!tr.ok) throw new Error(`token: HTTP ${tr.status}`);
  const { token } = await tr.json();

  const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
  const queue = jobs.slice(1);
  let current = null; // { id, chunks }
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => {
      try { ws.send(JSON.stringify({ type: 'session.end' })); } catch { /* closing anyway */ }
      try { ws.close(); } catch { /* closing anyway */ }
      reject(new Error(`render timed out in voice ${voice}`));
    }, 9 * 60_000);
    const finish = () => { clearTimeout(guard); resolve(audio); };

    ws.addEventListener('open', () => {
      // Same shape the product sends (verified live 2026-09-22): output.voice, no llm key.
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          system_prompt: 'You only say what you are instructed to say, word for word. Never add anything.',
          greeting: jobs[0].text,
          output: { voice },
        },
      }));
    });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      switch (m.type) {
        case 'session.ready':
          current = { id: jobs[0].id, chunks: [] };
          break;
        case 'reply.audio':
          if (current && typeof m.data === 'string') current.chunks.push(Buffer.from(m.data, 'base64'));
          break;
        case 'reply.done': {
          if (current) {
            const pcm = Buffer.concat(current.chunks);
            audio.set(current.id, pcm);
            console.log(`  ${voice} ${current.id} ${(pcm.length / 2 / SAMPLE_RATE).toFixed(2)} s`);
          }
          const job = queue.shift();
          if (!job) {
            current = null;
            ws.send(JSON.stringify({ type: 'session.end' }));
            return;
          }
          current = { id: job.id, chunks: [] };
          ws.send(JSON.stringify({ type: 'reply.create', instructions: `Say exactly the following and nothing else: ${job.text}` }));
          break;
        }
        case 'session.error':
        case 'error':
          console.error('server:', m.message ?? m.code ?? m);
          break;
        case 'session.ended':
          finish();
          break;
      }
    });
    ws.addEventListener('close', finish);
    ws.addEventListener('error', (e) => console.error('socket error', e.message ?? ''));
  });
}

const jobsFor = (who) => wanted.flatMap((l) => l.segments
  .map((s, i) => ({ who: s.who, id: `${l.n}.${i}`, text: s.text }))
  .filter((j) => j.who === who));

console.log(`narrator voice ${NARRATOR_VOICE}, rep voice ${REP_VOICE}, ${wanted.length} line(s)`);
const narrator = await renderSession(NARRATOR_VOICE, jobsFor('narrator'));
const rep = await renderSession(REP_VOICE, jobsFor('rep'));

const gap = Buffer.alloc(Math.round(GAP_SECONDS * SAMPLE_RATE) * 2);
const index = only && existsSync(path.join(out, 'index.json'))
  ? JSON.parse(readFileSync(path.join(out, 'index.json'), 'utf8')).filter((e) => !only.has(e.n))
  : [];
for (const l of wanted) {
  const parts = l.segments.map((s, i) => {
    const id = `${l.n}.${i}`;
    const pcm = (s.who === 'rep' ? rep : narrator).get(id);
    if (!pcm) throw new Error(`no audio came back for line ${l.n} segment ${i}`);
    return s.who === 'rep' ? phoneLine(pcm) : pcm;
  });
  const joined = Buffer.concat(parts.flatMap((p, i) => (i === 0 ? [p] : [gap, p])));
  const name = `${String(l.n).padStart(2, '0')}.wav`;
  writeFileSync(path.join(out, name), wav(joined));
  const seconds = joined.length / 2 / SAMPLE_RATE;
  index.push({ n: l.n, file: name, seconds: Number(seconds.toFixed(2)), text: l.caption });
  console.log(`${name} ${seconds.toFixed(2)} s`);
}
index.sort((a, b) => a.n - b.n);
writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2));
console.log(`wrote ${index.length} lines to ${out}/index.json`);
process.exit(0);
