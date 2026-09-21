import type { SessionRegistry } from './session-registry';

/**
 * Client for the AssemblyAI Voice Agent API (wss://agents.assemblyai.com/v1/ws).
 * Protocol per the events reference: session.update FIRST, then input.audio; reply.create for an
 * agent-initiated utterance; session.end to close. Audio both ways is base64 PCM16 mono at 24 kHz.
 *
 * The agent is a mouth, not a hand: this class never writes to the ledger. Callers hand it text that
 * was assembled from statement rows and it speaks exactly that.
 */
export const VOICE_AGENT_URL = 'wss://agents.assemblyai.com/v1/ws';

export interface SessionConfig {
  systemPrompt: string;
  /** Spoken verbatim by TTS, never through the LLM. Immutable after session.ready. */
  greeting: string;
  keyterms: readonly string[];
  voice?: string;
}

export interface AgentHandlers {
  onReady?: (sessionId: string | null) => void;
  /** A FINALIZED user (Rep) turn. Deltas are not surfaced: nothing is written from a partial. */
  onUserTurn?: (text: string, receivedAt: number) => void;
  /** What the agent actually said (transcript.agent), for the self-check. */
  onAgentTranscript?: (text: string) => void;
  onAudio?: (base64Pcm16: string, receivedAt: number) => void;
  onSpeechStarted?: () => void;
  onReplyDone?: () => void;
  onError?: (message: string) => void;
  onClosed?: (reason: string, durationMs: number) => void;
}

interface SocketLike {
  send(data: string): void;
  close(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: (ev: any) => void): void;
  readyState: number;
}
export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

let counter = 0;

export class VoiceAgentSession {
  readonly id = `va-${(counter += 1)}`;
  private socket: SocketLike | null = null;
  private openedAt = 0;
  private closed = false;
  private exitReason: string | null = null;
  private ready = false;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly handlers: AgentHandlers,
    private readonly makeSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The token is single-use: the caller mints a fresh one for every connect. */
  connect(token: string, config: SessionConfig): void {
    if (this.socket) throw new Error('session already connected');
    const url = new URL(VOICE_AGENT_URL);
    url.searchParams.set('token', token);
    const ws = this.makeSocket(url.toString());
    this.socket = ws;
    this.openedAt = this.now();
    this.registry.register(this);

    ws.addEventListener('open', (() => {
      // session.update must be the FIRST message: greeting and voice are immutable after ready.
      this.send({
        type: 'session.update',
        session: {
          system_prompt: config.systemPrompt,
          greeting: config.greeting,
          input: { keyterms: [...config.keyterms] },
          output: { voice: config.voice ?? 'alba' },
        },
      });
    }) as never);
    ws.addEventListener('message', ((ev: { data: string }) => this.onMessage(ev.data)) as never);
    ws.addEventListener('error', (() => this.handlers.onError?.('socket error')) as never);
    ws.addEventListener('close', (() => this.finish('socket-closed')) as never);
  }

  private onMessage(raw: string): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const at = this.now();
    // Event names are from the events reference. Payload field names (text/transcript, audio) are
    // read defensively and must be confirmed with the live spike (see docs/PROJECT-STATE.md).
    const text = String(m.text ?? m.transcript ?? '');
    switch (m.type) {
      case 'session.ready':
        this.ready = true;
        this.handlers.onReady?.(typeof m.session_id === 'string' ? m.session_id : null);
        break;
      case 'transcript.user':
        if (text.trim()) this.handlers.onUserTurn?.(text, at);
        break;
      case 'transcript.agent':
        if (text.trim()) this.handlers.onAgentTranscript?.(text);
        break;
      case 'reply.audio':
        if (typeof m.audio === 'string') this.handlers.onAudio?.(m.audio, at);
        break;
      case 'input.speech.started':
        this.handlers.onSpeechStarted?.();
        break;
      case 'reply.done':
        this.handlers.onReplyDone?.();
        break;
      case 'session.error':
      case 'error':
        this.handlers.onError?.(String(m.message ?? m.code ?? 'session error'));
        break;
      case 'session.ended':
        this.finish('session-ended');
        break;
    }
  }

  get isReady(): boolean {
    return this.ready && !this.closed;
  }

  /** Stream Rep audio in (base64 PCM16, ~50 ms chunks). Dropped, never queued, when not ready. */
  sendAudio(base64Pcm16: string): void {
    if (!this.isReady) return;
    this.send({ type: 'input.audio', audio: base64Pcm16 });
  }

  /** Speak assembled text. The instruction forbids the model from adding facts. */
  say(text: string): void {
    this.send({ type: 'reply.create', instructions: `Say exactly the following and nothing else: ${text}` });
  }

  /** Every exit path lands here: ask the server to end, then close the socket. Idempotent. */
  close(reason: string): void {
    if (this.closed) return;
    // socket.close() fires the close event synchronously: remember WHY we are closing first.
    this.exitReason = reason;
    try {
      if (this.socket && this.socket.readyState === OPEN) this.send({ type: 'session.end' });
    } catch {
      /* closing anyway */
    }
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.finish(reason);
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const why = this.exitReason ?? reason;
    this.registry.released(this.id, why);
    this.handlers.onClosed?.(why, this.now() - this.openedAt);
  }

  private send(payload: unknown): void {
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify(payload));
  }
}
