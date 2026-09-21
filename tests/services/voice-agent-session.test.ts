import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from '@/services/session-registry';
import { VoiceAgentSession, type AgentHandlers, type SessionConfig } from '@/services/voice-agent-session';

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
  it('sends session.update FIRST with the greeting, keyterms and voice', () => {
    const { session, sock } = setup();
    session.connect('tok', CONFIG);
    sock().open();
    const first = sock().sent[0] as { type: string; session: Record<string, unknown> };
    expect(first.type).toBe('session.update');
    expect(first.session.greeting).toBe(CONFIG.greeting);
    expect(first.session.input).toEqual({ keyterms: ['8K2J-338', 'Meridian'] });
    expect(sock().sent).toHaveLength(1);
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
