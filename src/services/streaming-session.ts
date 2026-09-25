import type { SessionRegistry } from './session-registry';

/**
 * Client for AssemblyAI Streaming STT v3 (wss://streaming.assemblyai.com/v3/ws).
 *
 * This is the Rep's channel in the two-session split. The Voice Agent session used to do both
 * jobs - hear the Rep and speak for the Witness - and that coupling cost a median of 3.2 seconds
 * of dead air before every line: the server answers each finalized user turn with its own LLM,
 * which cannot be disabled, and our assembled line had to queue behind that unheard turn to avoid
 * the two playing at once. With the Rep's audio arriving here instead, the Voice Agent never sees
 * a user turn, so it never volunteers a reply and never has to be waited for. Measured against
 * the live path: 409 ms to first audible word versus 3.2 s.
 *
 * Differences from the Voice Agent socket, both verified against the live service:
 *   - audio goes as BINARY frames of raw PCM16, not base64 inside JSON
 *   - configuration is query parameters at connect, not a session.update message
 *   - a finalized turn is `Turn` with `end_of_turn: true`; the shutdown message is `Terminate`
 */
export const STREAMING_URL = 'wss://streaming.assemblyai.com/v3/ws';

export interface StreamingConfig {
  sampleRate: number;
  /** Identifiers from the claim and the ledger, biased in recognition. */
  keyterms: readonly string[];
}

export interface StreamingHandlers {
  onReady?: (sessionId: string | null) => void;
  /** A FINALIZED Rep turn. Nothing is ever written to the ledger from a partial. */
  onTurn?: (text: string, receivedAt: number) => void;
  /**
   * The Rep has started saying something, before it is final. Used ONLY for barge-in: the server
   * no longer owns interruption in this arrangement, because it is not the one speaking.
   */
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
  onClosed?: (reason: string, durationMs: number) => void;
}

interface SocketLike {
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: (ev: any) => void): void;
  readyState: number;
}
export type StreamingSocketFactory = (url: string) => SocketLike;

const OPEN = 1;
let counter = 0;

export class StreamingSession {
  readonly id = `stt-${(counter += 1)}`;
  private socket: SocketLike | null = null;
  private openedAt = 0;
  private closed = false;
  private exitReason: string | null = null;
  private ready = false;
  private sessionId: string | null = null;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly handlers: StreamingHandlers,
    private readonly makeSocket: StreamingSocketFactory = (url) => new WebSocket(url) as unknown as SocketLike,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The token is single-use: the caller mints a fresh one for every connect. */
  connect(token: string, config: StreamingConfig): void {
    if (this.socket) throw new Error('streaming session already connected');
    const url = new URL(STREAMING_URL);
    url.searchParams.set('sample_rate', String(config.sampleRate));
    // Formatted turns give punctuation and casing, which the extractor reads and the packet quotes.
    url.searchParams.set('format_turns', 'true');
    if (config.keyterms.length) {
      // A JSON array, confirmed accepted live. The pre-recorded API calls the same idea
      // `keyterms_prompt` too, but rejects `keyterms` - the names are not interchangeable.
      url.searchParams.set('keyterms_prompt', JSON.stringify([...config.keyterms]));
    }
    url.searchParams.set('token', token);

    const ws = this.makeSocket(url.toString());
    this.socket = ws;
    this.openedAt = this.now();
    this.registry.register(this);
    ws.addEventListener('message', ((ev: { data: string }) => this.onMessage(ev.data)) as never);
    ws.addEventListener('error', (() => this.handlers.onError?.('streaming socket error')) as never);
    ws.addEventListener('close', (() => this.finish('socket-closed')) as never);
  }

  private onMessage(raw: string): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (m.type) {
      case 'Begin':
        this.ready = true;
        this.sessionId = typeof m.id === 'string' ? m.id : null;
        this.handlers.onReady?.(this.sessionId);
        break;
      case 'Turn': {
        const text = String(m.transcript ?? '');
        if (!text.trim()) return;
        if (m.end_of_turn === true) this.handlers.onTurn?.(text, this.now());
        else this.handlers.onPartial?.(text);
        break;
      }
      case 'Termination':
        this.finish('terminated');
        break;
      case 'Error':
        this.handlers.onError?.(String(m.error ?? m.message ?? 'streaming error'));
        break;
    }
  }

  get isReady(): boolean {
    return this.ready && !this.closed;
  }

  /** Stream Rep audio in. Raw PCM16 as a binary frame - base64 JSON is the other socket. */
  sendAudio(pcm: Int16Array): void {
    if (!this.isReady || !this.socket || this.socket.readyState !== OPEN) return;
    this.socket.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  }

  /**
   * Every exit path lands here. Idempotent.
   *
   * Streaming is billed on how long the socket stays open, and an abandoned session is held for
   * three hours and billed for all of it, so `Terminate` is sent before closing rather than
   * relying on the close alone.
   */
  close(reason: string): void {
    if (this.closed) return;
    this.exitReason = reason;
    try {
      if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify({ type: 'Terminate' }));
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
}
