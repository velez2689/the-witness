// Step 7 check: transcribe every docs/assets/narration/NN.wav with Streaming STT v3 and compare it
// to the numbered line in docs/submission/narration.md, to catch a voice agent that rephrased.
//
//   node --env-file=.env fixtures/scripts/check-narration.mjs [outJson]
//
// One stream per line, started at least 13 s apart to stay inside the 5-new-streams-per-minute
// allowance. Both sides are normalised (lowercase, digits spelled out, punctuation dropped) and
// scored by word-level edit distance; anything under 0.90 is listed for a human to read.
// Key comes from env. Never printed.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) { console.error('NO KEY'); process.exit(1); }
const RATE = 24_000;
const out = process.argv[2] ?? 'narration-check.json';

const script = new Map(readFileSync('docs/submission/narration.md', 'utf8').split(/\r?\n/)
  .map((l) => /^(\d+)\.\s+(.*)$/.exec(l)).filter(Boolean).map((m) => [Number(m[1]), m[2].split(' || ').map((s) => s.trim().replace(/^REP: /, '')).join(' ')]));

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = 'x x twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
function say(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + say(n % 100) : '');
  if (n < 1e6) return say(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + say(n % 1000) : '');
  return String(n);
}
function norm(s) {
  return s.toLowerCase()
    .replace(/\$(\d+)/g, '$1 dollars').replace(/(\d+)%/g, '$1 percent')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\d+/g, (d) => (d.length <= 6 ? ' ' + say(Number(d)) + ' ' : d))
    .replace(/[-–—]/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
}
function similarity(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}
function pcmOf(buf) {
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size;
  }
  throw new Error('no data chunk');
}

async function transcribe(pcm) {
  pcm = Buffer.concat([pcm, Buffer.alloc(RATE * 2 * 3)]);
  const tr = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=60', { headers: { Authorization: key } });
  if (!tr.ok) throw new Error(`token HTTP ${tr.status}`);
  const { token } = await tr.json();
  const url = new URL('wss://streaming.assemblyai.com/v3/ws');
  for (const [k, v] of Object.entries({ sample_rate: RATE, format_turns: 'true', speech_model: 'universal-3-5-pro',
    max_turn_silence: 2000, min_turn_silence: 400, voice_focus: 'near-field', inactivity_timeout: 120, token })) url.searchParams.set(k, String(v));
  const ws = new WebSocket(url);
  const turns = [];
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('timeout')), 40_000 + (pcm.length / 2 / RATE) * 1000);
    ws.addEventListener('error', () => reject(new Error('socket error')));
    ws.addEventListener('close', () => { clearTimeout(guard); resolve(turns.join(' ')); });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'Begin') {
        let i = 0; const step = (RATE / 20) * 2;
        const t = setInterval(() => {
          if (i >= pcm.length) { clearInterval(t); setTimeout(() => ws.send(JSON.stringify({ type: 'Terminate' })), 1500); return; }
          ws.send(pcm.subarray(i, i + step)); i += step;
        }, 50);
      } else if (m.type === 'Turn' && m.end_of_turn && m.transcript?.trim()) turns.push(m.transcript.trim());
      else if (m.type === 'Error') reject(new Error(JSON.stringify(m).slice(0, 200)));
    });
  });
}

const files = readdirSync('docs/assets/narration').filter((f) => /^\d+\.wav$/.test(f)).sort();
const results = [];
let lastStart = 0;
// RESCORE=1 reuses the transcripts already saved in outJson and opens no streams.
const prior = process.env.RESCORE ? new Map(JSON.parse(readFileSync(out, 'utf8')).map((r) => [r.n, r])) : null;
for (const f of files) {
  const n = Number(f.slice(0, -4));
  let heard = '', error = null;
  if (prior) {
    heard = prior.get(n)?.heard ?? '';
    error = prior.get(n)?.error ?? (prior.has(n) ? null : 'no saved transcript');
  } else {
    const wait = 13_000 - (Date.now() - lastStart);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
    try { heard = await transcribe(pcmOf(readFileSync(`docs/assets/narration/${f}`))); } catch (e) { error = String(e.message ?? e); }
  }
  const expected = script.get(n) ?? '';
  const score = error ? 0 : similarity(norm(expected), norm(heard));
  results.push({ n, score: Number(score.toFixed(3)), expected, heard, error });
  console.log(`${String(n).padStart(2)}  ${score.toFixed(2)}${error ? '  ERROR ' + error : ''}`);
  writeFileSync(out, JSON.stringify(results, null, 1));
}
const low = results.filter((r) => r.score < 0.9);
console.log(`--- DONE: ${results.length} lines, ${low.length} under 0.90, lines in script without audio: ${[...script.keys()].filter((n) => !files.includes(String(n).padStart(2, '0') + '.wav')).join(',') || 'none'}`);
