import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from '@/services/session-registry';
import { DEFAULT_VOICE, VoiceAgentSession, type AgentHandlers, type SessionConfig } from '@/services/voice-agent-session';

class FakeSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  closedByClient = false;
  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
    this.emit('close', {});
  }
  emit(type: string, ev: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  server(msg: Record<string, unknown>) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
}

const CONFIG: SessionConfig = {
  systemPrompt: 'Say only what you are told.',
  greeting: 'Hello, this is an AI assistant. This call is being recorded.',
  keyterms: ['8K2J-338', 'Meridian'],
};

function setup(handlers: AgentHandlers = {}) {
  const registry = new SessionRegistry(300);
  let socket!: FakeSocket;
  const session = new VoiceAgentSession(registry, handlers, () => (socket = new FakeSocket()));
  return { registry, session, sock: () => socket };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('VoiceAgentSession', () => {
  /**
   * These field names are the documented ones, checked against the session-configuration and
   * voices references. A later version of this test asserted the DOCUMENTED shape
   * (`voice.voice_id`, `transcription_mode`), which the live server rejects outright — on rejection the server falls back to
   * defaults for the ENTIRE session - empty system prompt, no greeting, stock voice - so the AI
   * disclosure would simply not have been spoken, with nothing anywhere reporting a problem.
   */
  it('sends session.update FIRST, in the documented field shape', () => {
    const { session, sock } = setup();
    session.connect('tok', CONFIG);
    sock().open();
    const first = sock().sent[0] as { type: string; session: Record<string, unknown> };
    expect(first.type).toBe('session.update');
    expect(first.session.greeting).toBe(CONFIG.greeting);
    expect(sock().sent).toHaveLength(1);

    // output.voice, never voice.voice_id: the server REJECTS the documented shape.
    expect(first.session.output).toEqual({ voice: DEFAULT_VOICE });
    expect(first.session.voice).toBeUndefined();

    // The ledger's identifiers reach the STT through BOTH hints; each was confirmed to apply.
    const input = first.session.input as Record<string, unknown>;
    expect(input.keyterms).toEqual(['8K2J-338', 'Meridian']);
    expect(String(input.transcription_prompt)).toContain('8K2J-338');
    expect(String(input.transcription_prompt)).toContain('Meridian');
    expect(input.transcription_mode).toBeUndefined();
  });

  /**
   * reply.audio delivers base64 PCM16 in `data`. This code read `audio` — a field the server
   * never sends — so the Witness would have run an entire call in total silence: sockets open,
   * transcripts arriving, latency measured, and not one audible word. There was no test here at
   * all, which is exactly why it survived to the day before the demo.
   */
  it('plays the audio the server actually sends, from reply.audio.data', () => {
    const heard: string[] = [];
    const { session, sock } = setup({ onAudio: (b64) => heard.push(b64) });
    session.connect('t', CONFIG);
    sock().open();
    sock().server({ type: 'session.ready', session_id: 's1' });
    sock().server({ type: 'reply.audio', data: 'QUJD' });
    expect(heard).toEqual(['QUJD']);
  });

  it('still plays audio if the field is ever renamed back to `audio`', () => {
    const heard: string[] = [];
    const { session, sock } = setup({ onAudio: (b64) => heard.push(b64) });
    session.connect('t', CONFIG);
    sock().open();
    sock().server({ type: 'session.ready', session_id: 's1' });
    sock().server({ type: 'reply.audio', audio: 'WFla' });
    expect(heard).toEqual(['WFla']);
  });

  it('reads the Rep turn from transcript.user.text', () => {
    const turns: string[] = [];
    const { session, sock } = setup({ onUserTurn: (t) => turns.push(t) });
    session.connect('t', CONFIG);
    sock().open();
    sock().server({ type: 'session.ready', session_id: 's1' });
    sock().server({ type: 'transcript.user', text: 'That claim denied. Timely filing.', item_id: 'i1' });
    expect(turns).toEqual(['That claim denied. Timely filing.']);
  });

  it('reads what the Witness said from transcript.agent.text, for the self-check', () => {
    const said: string[] = [];
    const { session, sock } = setup({ onAgentTranscript: (t) => said.push(t) });
    session.connect('t', CONFIG);
    sock().open();
    sock().server({ type: 'session.ready', session_id: 's1' });
    sock().server({ type: 'transcript.agent', text: 'Let me read that back: 8K2J-988.', reply_id: 'r1' });
    expect(said).toEqual(['Let me read that back: 8K2J-988.']);
  });

  it('puts the single-use token in the URL only', () => {
    const urls: string[] = [];
    const registry = new SessionRegistry(300);
    const s = new VoiceAgentSession(registry, {}, (u) => { urls.push(u); return new FakeSocket(); });
    s.connect('abc123', CONFIG);
    expect(urls[0]).toBe('wss://agents.assemblyai.com/v1/ws?token=abc123');
  });

  it('drops audio until session.ready, then streams it', () => {
    const { session, sock } = setup();
    session.connect('t', CONFIG);
    sock().open();
    session.sendAudio('AAAA');
    expect(sock().sent.some((m) => m.type === 'input.audio')).toBe(false);
    sock().server({ type: 'session.ready', session_id: 's1' });
    session.sendAudio('BBBB');
    expect(sock().sent.at(-1)).toEqual({ type: 'input.audio', audio: 'BBBB' });
  });

  it('surfaces finalized user turns only, and never a delta', () => {
    const turns: string[] = [];
    const { session, sock } = setup({ onUserTurn: (t) => turns.push(t) });
    session.connect('t', CONFIG);
    sock().open();
    sock().server({ type: 'transcript.user.delta', text: 'it was den' });
    sock().server({ type: 'transcript.user', text: 'It was denied for timely filing.' });
    expect(turns).toEqual(['It was denied for timely filing.']);
  });

  it('speaks assembled text with a verbatim-only instruction via reply.create', () => {
    const { session, sock } = setup();
    session.connect('t', CONFIG);
    sock().open();
    session.say('Let me read that back: eight K two J nine eight eight.');
    const m = sock().sent.at(-1) as { type: string; instructions: string };
    expect(m.type).toBe('reply.create');
    expect(m.instructions).toContain('Say exactly the following and nothing else:');
    expect(m.instructions).toContain('eight K two J nine eight eight');
  });

  it('close() sends session.end, closes the socket, and is idempotent', () => {
    const closed: string[] = [];
    const { session, sock, registry } = setup({ onClosed: (r) => closed.push(r) });
    session.connect('t', CONFIG);
    sock().open();
    session.close('user-stop');
    session.close('again');
    expect(sock().sent.at(-1)).toEqual({ type: 'session.end' });
    expect(sock().closedByClient).toBe(true);
    expect(closed).toEqual(['user-stop']);
    expect(registry.openCount).toBe(0);
    expect(registry.balanced).toBe(true);
  });

  it('a socket that drops on its own still releases the registry', () => {
    const { session, sock, registry } = setup();
    session.connect('t', CONFIG);
    sock().open();
    sock().emit('close', {});
    expect(registry.balanced).toBe(true);
    expect(session.isReady).toBe(false);
  });

  it('reports server errors without throwing', () => {
    const errors: string[] = [];
    const { session, sock } = setup({ onError: (e) => errors.push(e) });
    session.connect('t', CONFIG);
    sock().open();
    sock().server({ type: 'session.error', message: 'bad config' });
    expect(errors).toEqual(['bad config']);
  });
});

/**
 * The server answers every finalized user turn with its own LLM, and the API has no setting to
 * disable it. We drive the same session with reply.create, so before this both replies streamed
 * reply.audio and the caller played them simultaneously: two voices at once. A tester heard it as
 * a broken connection and as the Witness asking for a badge number he had just given it.
 *
 * These tests fix the rule that replaces it: only a reply we asked for is ever audible, and our
 * line never overlaps the model's.
 */
describe('turn ownership: the model may generate, but it is never heard', () => {
  function live(handlers: AgentHandlers = {}) {
    const h = setup(handlers);
    h.session.connect('t', CONFIG);
    h.sock().open();
    h.sock().server({ type: 'session.ready', session_id: 's1' });
    return h;
  }
  const replies = (s: FakeSocket) => s.sent.filter((m) => m.type === 'reply.create');

  it('drops audio from a reply the model volunteered', () => {
    const heard: string[] = [];
    const { session, sock } = live({ onAudio: (b) => heard.push(b) });
    sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' }); // greeting over
    sock().server({ type: 'transcript.user', text: 'This is Darnell, badge 2210.' });
    sock().server({ type: 'reply.started', reply_id: 'model-1' });
    sock().server({ type: 'reply.audio', data: 'TU9ERUw=' });
    expect(heard).toEqual([]);
    expect(session.isReady).toBe(true);
  });

  it('plays audio from the line we asked for', () => {
    const heard: string[] = [];
    const { session, sock } = live({ onAudio: (b) => heard.push(b) });
    sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    sock().server({ type: 'transcript.user', text: 'Denied for timely filing.' });
    session.say('Hang on, before we go further.');
    sock().server({ type: 'reply.started', reply_id: 'model-1' }); // model answers first
    sock().server({ type: 'reply.audio', data: 'TU9ERUw=' });
    sock().server({ type: 'reply.done', reply_id: 'model-1', status: 'completed' });
    sock().server({ type: 'reply.started', reply_id: 'ours-1' }); // now ours
    sock().server({ type: 'reply.audio', data: 'T1VSUw==' });
    expect(heard).toEqual(['T1VSUw==']);
  });

  /** The overlap itself: our line must not be sent while the model still owes a reply. */
  it('holds our line until the model has finished its unheard turn', () => {
    const { session, sock } = live();
    sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    sock().server({ type: 'transcript.user', text: 'Timely filing.' });
    session.say('Which one is actually on the claim?');
    expect(replies(sock())).toHaveLength(0); // still waiting on the model
    sock().server({ type: 'reply.started', reply_id: 'model-1' });
    sock().server({ type: 'reply.done', reply_id: 'model-1', status: 'completed' });
    expect(replies(sock())).toHaveLength(1);
    expect(String((replies(sock())[0] as { instructions: string }).instructions)).toContain('actually on the claim');
  });

  it('never has two of our lines in flight at once', () => {
    const { session, sock } = live();
    sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    session.say('one');
    session.say('two');
    expect(replies(sock())).toHaveLength(1);
    sock().server({ type: 'reply.started', reply_id: 'a' });
    sock().server({ type: 'reply.done', reply_id: 'a', status: 'completed' });
    expect(replies(sock())).toHaveLength(2);
  });

  /** If the model ever skips a turn, our line must not be stuck behind it forever. */
  it('speaks anyway when the model never replies', () => {
    const { session, sock } = live();
    sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    sock().server({ type: 'transcript.user', text: 'Hello?' });
    session.say('Could I get your name and badge number?');
    expect(replies(sock())).toHaveLength(0);
    vi.advanceTimersByTime(1_500);
    expect(replies(sock())).toHaveLength(1);
  });

  /**
   * The greeting carries the AI and recording disclosure. It is spoken by the session itself, so
   * it arrives with no reply.create behind it - and muting it would put out a call that never
   * discloses it is an AI. Of every line in the call this is the one that must always be heard.
   */
  it('always plays the greeting', () => {
    const heard: string[] = [];
    const { sock } = live({ onAudio: (b) => heard.push(b) });
    sock().server({ type: 'reply.started', reply_id: 'greet' });
    sock().server({ type: 'reply.audio', data: 'R1JFRVQ=' });
    expect(heard).toEqual(['R1JFRVQ=']);
  });

  it('self-checks only what the Witness actually said, and reports the rest as suppressed', () => {
    const checked: string[] = [];
    const muted: string[] = [];
    const { session, sock } = live({ onAgentTranscript: (t) => checked.push(t), onSuppressed: (t) => muted.push(t) });
    sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    sock().server({ type: 'transcript.user', text: 'Badge 2210.' });
    session.say('Let me read that back: eight K two J, nine eight eight.');
    sock().server({ type: 'reply.started', reply_id: 'model-1' });
    sock().server({ type: 'transcript.agent', text: "I didn't catch your name and badge number." });
    sock().server({ type: 'reply.done', reply_id: 'model-1', status: 'completed' });
    sock().server({ type: 'reply.started', reply_id: 'ours-1' });
    sock().server({ type: 'transcript.agent', text: 'Let me read that back: eight K two J, nine eight eight.' });
    expect(muted).toEqual(["I didn't catch your name and badge number."]);
    expect(checked).toEqual(['Let me read that back: eight K two J, nine eight eight.']);
  });

  /** A barge-in on the model's unheard turn must not flush OUR playback or close the call. */
  it('reports reply.done only for our own replies', () => {
    const dones: boolean[] = [];
    const { sock } = live({ onReplyDone: (i) => dones.push(i) });
    sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' }); // ours
    sock().server({ type: 'transcript.user', text: 'Hold on.' });
    sock().server({ type: 'reply.started', reply_id: 'model-1' });
    sock().server({ type: 'reply.done', reply_id: 'model-1', status: 'interrupted' });
    expect(dones).toEqual([false]);
  });
});

describe('SessionRegistry: every exit path ends the session', () => {
  it('kills a session at the hard timeout even if the client never closes it', () => {
    const { session, sock, registry } = setup();
    session.connect('t', CONFIG);
    sock().open();
    vi.advanceTimersByTime(300_000);
    expect(sock().sent.at(-1)).toEqual({ type: 'session.end' });
    expect(registry.log.find((l) => l.event === 'close')?.reason).toBe('hard-timeout');
    expect(registry.balanced).toBe(true);
  });

  it('closes on pagehide and beforeunload', () => {
    for (const ev of ['pagehide', 'beforeunload']) {
      const { session, sock, registry } = setup();
      const handlers = new Map<string, () => void>();
      registry.attachToWindow({
        addEventListener: (t: string, fn: EventListenerOrEventListenerObject) => handlers.set(t, fn as () => void),
        removeEventListener: () => undefined,
      });
      session.connect('t', CONFIG);
      sock().open();
      handlers.get(ev)!();
      expect(registry.openCount).toBe(0);
      expect(registry.log.find((l) => l.event === 'close')?.reason).toBe('page-exit');
    }
  });

  it('closeAll ends every open session and the log balances', () => {
    const registry = new SessionRegistry(300);
    const socks: FakeSocket[] = [];
    const a = new VoiceAgentSession(registry, {}, () => { const s = new FakeSocket(); socks.push(s); return s; });
    const b = new VoiceAgentSession(registry, {}, () => { const s = new FakeSocket(); socks.push(s); return s; });
    a.connect('t1', CONFIG); b.connect('t2', CONFIG);
    socks.forEach((s) => s.open());
    expect(registry.openCount).toBe(2);
    registry.closeAll('reset');
    expect(registry.openCount).toBe(0);
    expect(registry.balanced).toBe(true);
    expect(socks.every((s) => s.closedByClient)).toBe(true);
  });
});
