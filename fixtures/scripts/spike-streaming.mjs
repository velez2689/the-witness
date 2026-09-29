// Spike: connect to Streaming STT v3 with the EXACT query string StreamingSession.connect builds
// (src/services/streaming-session.ts) and STT_SETTINGS (src/services/live-call.ts), stream audio at
// real-time pace, and print every Begin, Turn (with words) and Error. A rejected parameter shows up
// as an Error or an early close; a silently ignored one shows up as a turn that splits anyway.
//
//   node --env-file=.env fixtures/scripts/spike-streaming.mjs <file.wav>            (24 kHz mono PCM16)
//   node --env-file=.env fixtures/scripts/spike-streaming.mjs --say "Eight K two J" "nine eight eight"
//
// --say renders the parts with the Voice Agent API (as render-narration.mjs does) and joins them
// with 1.2 s of silence, so the pause the badge-number defect depends on is under our control.
// Optional: SPIKE_OMIT=voice_focus,min_turn_silence drops parameters to bisect a rejection.
// Key comes from env. Never printed. A run opens 1 or 2 streams of the 5-per-minute allowance.
import { readFileSync } from 'node:fs';

const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) { console.error('NO KEY'); process.exit(1); }
const RATE = 24_000;

// Mirror of STT_SETTINGS in src/services/live-call.ts. Keep the two in step.
const SETTINGS = {
  speech_model: 'universal-3-5-pro',
  max_turn_silence: '2000',
  min_turn_silence: '400',
  voice_focus: 'near-field',
  inactivity_timeout: '120',
};
const KEYTERMS = ['8K2J-988', '8K2J-702', 'Meridian Health Plan', 'Darnell', '2210'];
const omit = new Set((process.env.SPIKE_OMIT ?? '').split(',').filter(Boolean));

function pcmOf(wavBuf) {
  let off = 12;
  while (off < wavBuf.length - 8) {
    const id = wavBuf.toString('ascii', off, off + 4), size = wavBuf.readUInt32LE(off + 4);
    if (id === 'data') return wavBuf.subarray(off + 8, off + 8 + size);
    off += 8 + size;
  }
  throw new Error('no data chunk');
}

async function say(text) {
  const u = new URL('https://agents.assemblyai.com/v1/token');
  u.searchParams.set('expires_in_seconds', '60');
  u.searchParams.set('max_session_duration_seconds', '60');
  const tr = await fetch(u, { headers: { Authorization: `Bearer ${key}` } });
  if (!tr.ok) throw new Error(`agent token HTTP ${tr.status}`);
  const { token } = await tr.json();
  const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
  const chunks = [];
  await new Promise((resolve, reject) => {
    let started = false;
    ws.addEventListener('error', () => reject(new Error('agent socket error')));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'session.ready' && !started) {
        started = true;
        ws.send(JSON.stringify({ type: 'reply.create', instructions: `Say exactly the following and nothing else: ${text}` }));
      } else if (m.type === 'reply.audio') chunks.push(Buffer.from(m.data, 'base64'));
      else if (m.type === 'reply.done') { ws.send(JSON.stringify({ type: 'session.end' })); resolve(); }
    });
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'session.update', session: {
      system_prompt: 'You only say what you are instructed to say.', greeting: '', output: { voice: 'jean' } } })));
    setTimeout(() => reject(new Error('say timeout')), 30_000);
  });
  return Buffer.concat(chunks);
}

let pcm;
const args = process.argv.slice(2);
if (args[0] === '--say') {
  const parts = [];
  for (const t of args.slice(1)) {
    parts.push(await say(t));
    parts.push(Buffer.alloc(Math.round(RATE * 1.2) * 2));
  }
  parts.pop(); // no trailing pause from us
  pcm = Buffer.concat(parts);
} else if (args[0]) {
  pcm = pcmOf(readFileSync(args[0]));
} else { console.error('usage: <file.wav> | --say <part> [<part>...]'); process.exit(1); }
pcm = Buffer.concat([pcm, Buffer.alloc(RATE * 2 * 3)]); // 3 s of trailing silence closes the last turn
console.log(`audio: ${(pcm.length / 2 / RATE).toFixed(1)} s`);

const tr = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=60', { headers: { Authorization: key } });
console.log('stt token status', tr.status);
if (!tr.ok) { console.log((await tr.text()).slice(0, 300)); process.exit(1); }
const { token } = await tr.json();

const url = new URL('wss://streaming.assemblyai.com/v3/ws');
url.searchParams.set('sample_rate', String(RATE));
url.searchParams.set('format_turns', 'true');
url.searchParams.set('keyterms_prompt', JSON.stringify(KEYTERMS));
for (const [k, v] of Object.entries(SETTINGS)) if (!omit.has(k)) url.searchParams.set(k, v);
url.searchParams.set('token', token);
console.log('params sent:', [...url.searchParams.keys()].filter((k) => k !== 'token').join(', '));

const ws = new WebSocket(url);
const t0 = Date.now();
const log = (m) => console.log(`+${Date.now() - t0}ms ${m}`);
let turns = 0, errors = 0, begun = false;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'Begin') { begun = true; log('Begin ' + JSON.stringify({ id: m.id })); stream(); }
  else if (m.type === 'Turn') {
    if (m.end_of_turn) { turns++; log(`TURN ${turns} (${(m.words ?? []).length} words): ${JSON.stringify(m.transcript)}`); }
  } else if (m.type === 'Termination') log('Termination ' + JSON.stringify(m).slice(0, 200));
  else { if (m.type === 'Error' || m.error) errors++; log(`${m.type}: ${JSON.stringify(m).slice(0, 400)}`); }
});
ws.addEventListener('error', () => log('socket error'));
ws.addEventListener('close', (e) => { log(`close ${e.code} ${e.reason}`); finish(); });

function stream() {
  const chunk = (RATE / 20) * 2; // 50 ms
  let i = 0;
  const timer = setInterval(() => {
    if (i >= pcm.length) { clearInterval(timer); setTimeout(() => { try { ws.send(JSON.stringify({ type: 'Terminate' })); } catch {} }, 1500); return; }
    ws.send(pcm.subarray(i, i + chunk));
    i += chunk;
  }, 50);
}
function finish() {
  console.log('--- SUMMARY ---');
  console.log(`begun: ${begun} | final turns: ${turns} | errors: ${errors}`);
  process.exit(0);
}
setTimeout(finish, 60_000 + (pcm.length / 2 / RATE) * 1000);
