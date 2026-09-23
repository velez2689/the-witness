// Spike: mint a Voice Agent token, connect, send our real session.update, and READ BACK what the
// server accepted. session.updated echoes the applied config, which is the only way to tell an
// accepted field from one the server silently ignored — a silently-ignored transcription_prompt
// means the STT never learns this call's reference numbers, and nothing would ever warn us.
//
// Key comes from env (node --env-file=.env). Never printed.
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) { console.log('NO KEY'); process.exit(1); }

const tokenUrl = new URL('https://agents.assemblyai.com/v1/token');
tokenUrl.searchParams.set('expires_in_seconds', '60');
tokenUrl.searchParams.set('max_session_duration_seconds', '60');
const tr = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${key}` } });
console.log('token status', tr.status);
if (!tr.ok) { console.log((await tr.text()).slice(0, 300)); process.exit(1); }
const { token } = await tr.json();

const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
const t0 = Date.now();
const log = (m) => console.log(`+${Date.now() - t0}ms ${m}`);
let audioChunks = 0, audioField = null, firstAudioAt = null;
const seen = new Set();

// Exactly what src/services/voice-agent-session.ts sends.
const session = {
  system_prompt: 'You only say what you are instructed to say. Never invent an identifier.',
  greeting: 'Hello, this is an AI assistant calling on behalf of the billing office. This call is recorded.',
  input: {
    transcription_mode: 'max_accuracy',
    transcription_prompt: '8K2J-988, 8K2J-702, Meridian Health Plan, Darnell, badge 2210',
  },
  voice: { voice_id: 'alba' },
};

ws.addEventListener('open', () => {
  log('open');
  ws.send(JSON.stringify({ type: 'session.update', session }));
});

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  seen.add(m.type);

  if (m.type === 'reply.audio') {
    audioChunks += 1;
    if (!audioField) {
      audioField = typeof m.data === 'string' ? 'data' : typeof m.audio === 'string' ? 'audio' : 'UNKNOWN:' + Object.keys(m).join('|');
      firstAudioAt = Date.now() - t0;
      log(`FIRST AUDIO via field "${audioField}"`);
    }
    return;
  }

  const short = { ...m };
  if (short.data) short.data = '<b64>';
  if (short.audio) short.audio = '<b64>';
  log(JSON.stringify(short).slice(0, 700));

  if (m.type === 'session.ready' || m.type === 'session.updated') {
    // The echo: which of our fields survived?
    const c = m.config ?? m.session ?? null;
    if (c) {
      console.log('   ACCEPTED CONFIG KEYS:', Object.keys(c).join(', '));
      if (c.input) console.log('   input keys:', Object.keys(c.input).join(', '), '| transcription_prompt kept:', Boolean(c.input.transcription_prompt), '| keyterms present:', 'keyterms' in c.input);
      if (c.voice) console.log('   voice:', JSON.stringify(c.voice));
      if (c.output) console.log('   output:', JSON.stringify(c.output));
      if (c.llm || c.model) console.log('   llm/model echo:', JSON.stringify(c.llm ?? c.model));
    }
  }
  if (m.type === 'session.ready') {
    ws.send(JSON.stringify({
      type: 'reply.create',
      instructions: 'Say exactly the following and nothing else: Let me read that back: eight K two J nine eight eight. Is that correct?',
    }));
  }
  if (m.type === 'transcript.agent') {
    console.log('   AGENT SAID:', JSON.stringify(m.text ?? m.transcript ?? '(no text field!)'));
  }
});

ws.addEventListener('error', (e) => log('error ' + (e.message ?? '')));
ws.addEventListener('close', (e) => { log(`close ${e.code} ${e.reason}`); finish(); });

function finish() {
  console.log('--- SUMMARY ---');
  console.log('events seen:', [...seen].sort().join(', '));
  console.log('audio chunks:', audioChunks, '| field:', audioField, '| first audio at:', firstAudioAt + 'ms');
  process.exit(0);
}

setTimeout(() => { try { ws.send(JSON.stringify({ type: 'session.end' })); } catch {} }, 14000);
setTimeout(finish, 20000);
