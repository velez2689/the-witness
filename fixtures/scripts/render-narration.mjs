// Render docs/submission/narration.md with the AssemblyAI Voice Agent API, the way the product
// speaks: the first line is the session greeting, every other line goes out as reply.create with
// "say exactly the following", and the audio that comes back is saved one WAV per line.
//
//   node --env-file=.env fixtures/scripts/render-narration.mjs [outDir]
//
// Needs ASSEMBLYAI_API_KEY in the environment (never printed). Writes <outDir>/NN.wav (24 kHz
// mono PCM16) and <outDir>/index.json with each line's text and duration, which the footage
// script and the mux step read. One session, closed with session.end at the end.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) {
  console.error('ASSEMBLYAI_API_KEY is not set');
  process.exit(1);
}
const out = process.argv[2] ?? 'docs/assets/narration';
mkdirSync(out, { recursive: true });

const lines = readFileSync('docs/submission/narration.md', 'utf8')
  .split('\n')
  .map((l) => /^(\d+)\.\s+(.*)$/.exec(l))
  .filter(Boolean)
  .map((m) => ({ n: Number(m[1]), text: m[2].trim() }));
if (lines.length === 0) throw new Error('no numbered lines found in narration.md');

const tokenUrl = new URL('https://agents.assemblyai.com/v1/token');
tokenUrl.searchParams.set('expires_in_seconds', '60');
tokenUrl.searchParams.set('max_session_duration_seconds', '600');
const tr = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${key}` } });
if (!tr.ok) throw new Error(`token: HTTP ${tr.status}`);
const { token } = await tr.json();

const SAMPLE_RATE = 24_000;
const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
const index = [];
let current = null; // { n, text, chunks: Buffer[] }
let queue = lines.slice(1);
let done;
const finished = new Promise((r) => (done = r));

function wav(chunks) {
  const data = Buffer.concat(chunks);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function save() {
  if (!current) return;
  const bytes = wav(current.chunks);
  const seconds = (bytes.length - 44) / 2 / SAMPLE_RATE;
  const name = `${String(current.n).padStart(2, '0')}.wav`;
  writeFileSync(path.join(out, name), bytes);
  index.push({ n: current.n, file: name, seconds: Number(seconds.toFixed(2)), text: current.text });
  console.log(`${name} ${seconds.toFixed(2)} s`);
  current = null;
}

function next() {
  const line = queue.shift();
  if (!line) {
    ws.send(JSON.stringify({ type: 'session.end' }));
    return;
  }
  current = { n: line.n, text: line.text, chunks: [] };
  ws.send(JSON.stringify({ type: 'reply.create', instructions: `Say exactly the following and nothing else: ${line.text}` }));
}

ws.addEventListener('open', () => {
  // Same shape the product sends (verified live 2026-09-22): output.voice, no llm key.
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      system_prompt: 'You only say what you are instructed to say, word for word. Never add anything.',
      greeting: lines[0].text,
      output: { voice: process.env.WITNESS_VOICE ?? 'jean' },
    },
  }));
});

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  switch (m.type) {
    case 'session.ready':
      current = { n: lines[0].n, text: lines[0].text, chunks: [] };
      break;
    case 'reply.audio':
      if (current && typeof m.data === 'string') current.chunks.push(Buffer.from(m.data, 'base64'));
      break;
    case 'reply.done':
      save();
      // Do not send audio to this socket; it never produces a user turn, so the next line can go now.
      next();
      break;
    case 'session.error':
    case 'error':
      console.error('server:', m.message ?? m.code ?? m);
      break;
    case 'session.ended':
      done();
      break;
  }
});
ws.addEventListener('close', () => done());
ws.addEventListener('error', (e) => console.error('socket error', e.message ?? ''));

// A whole narration is a few minutes; never leave a billed socket open past that.
setTimeout(() => { try { ws.send(JSON.stringify({ type: 'session.end' })); } catch {} ws.close(); }, 9 * 60_000);

await finished;
index.sort((a, b) => a.n - b.n);
writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2));
console.log(`wrote ${index.length} lines to ${out}/index.json`);
process.exit(0);
