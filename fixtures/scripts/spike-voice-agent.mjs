// Spike: mint a Voice Agent token, connect, send session.update, reply.create, observe events.
// Key comes from env (node --env-file). Never printed.
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) { console.log('NO KEY'); process.exit(1); }

const variant = process.argv[2] ?? 'plain';
const tokenUrl = new URL('https://agents.assemblyai.com/v1/token');
tokenUrl.searchParams.set('expires_in_seconds', '60');
tokenUrl.searchParams.set('max_session_duration_seconds', '60');
const tr = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${key}` } });
console.log('token status', tr.status);
if (!tr.ok) { console.log((await tr.text()).slice(0, 300)); process.exit(1); }
const { token } = await tr.json();

const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
const t0 = Date.now();
const log = (m) => console.log(`+${Date.now() - t0}ms`, m);
let audioChunks = 0;
const session = {
  system_prompt: 'You are a concise assistant that only says what you are instructed to say.',
  greeting: 'Hello, this is an AI assistant calling on behalf of the billing office. This call is being recorded.',
  input: { keyterms: ['8K2J-988', 'Meridian'] },
  output: { voice: 'alba' },
};
if (variant === 'llm') session.llm = { model: 'qwen3.5-4b-fast' };
if (variant === 'model') session.model = 'qwen3.5-4b-fast';

ws.addEventListener('open', () => {
  log('open');
  ws.send(JSON.stringify({ type: 'session.update', session }));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'reply.audio') { audioChunks += 1; return; }
  const short = { ...m };
  if (short.audio) short.audio = '<b64>';
  log(JSON.stringify(short).slice(0, 300));
  if (m.type === 'session.ready') {
    ws.send(JSON.stringify({ type: 'reply.create', instructions: 'Say exactly the following and nothing else: Let me read that back: eight K two J nine eight eight. Is that correct?' }));
  }
  if (m.type === 'reply.done') {
    log(`audio chunks so far: ${audioChunks}`);
  }
});
ws.addEventListener('error', (e) => log('error ' + (e.message ?? '')));
ws.addEventListener('close', (e) => { log(`close ${e.code} ${e.reason}`); process.exit(0); });
setTimeout(() => { try { ws.send(JSON.stringify({ type: 'session.end' })); } catch {} }, 14000);
setTimeout(() => { log(`final audio chunks ${audioChunks}`); process.exit(0); }, 18000);
