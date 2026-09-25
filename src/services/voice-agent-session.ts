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

/**
 * Turn detection, tuned for a payer call rather than a chat.
 *
 * `min_silence` is the reason this is set at all. A rep reading an identifier off a screen pauses
 * inside it — "Eight-K-two-J... nine-eight-eight" — and at the 1000 ms default that lands as two
 * turns. Our extractor would then see "8K2J" and "988" as separate runs and file a reference
 * number that was never spoken. 1800 ms keeps the identifier whole.
 *
 * `interrupt_response` stays on: if the Rep talks over the Witness, the Rep wins. Every one of
 * these is updatable mid-session, so they are a starting point for real calls, not a final answer.
 */
export const TURN_DETECTION = {
  vad_threshold: 0.5,
  min_silence: 1800,
  max_silence: 5000,
  interrupt_response: true,
  interruption_delay: 150,
} as const;

/**
 * Voice isolation. A judge demos on a laptop, so the Witness's own voice comes out of the speakers
 * and straight back into the microphone; near-field is what keeps that from being transcribed as
 * the Rep. Set at connect — a mid-session change only applies on the next STT reconnect.
 */
export const VOICE_FOCUS = 'near-field';
export const VOICE_FOCUS_THRESHOLD = 0.85;

export interface AgentHandlers {
  onReady?: (sessionId: string | null) => void;
  /** A FINALIZED user (Rep) turn. Deltas are not surfaced: nothing is written from a partial. */
  onUserTurn?: (text: string, receivedAt: number) => void;
  /** What the agent actually said (transcript.agent), for the self-check. */
  onAgentTranscript?: (text: string) => void;
  onAudio?: (base64Pcm16: string, receivedAt: number) => void;
  onSpeechStarted?: () => void;
  /** True when the Rep talked over the Witness and the server cut the reply short. */
  onReplyDone?: (interrupted: boolean) => void;
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
  private resumeToken: string | null = null;
  private sessionId: string | null = null;

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
      /**
       * Field shapes VERIFIED against the live server on 2026-09-22, not against the docs.
       *
       * The voices documentation describes `voice.voice_id`; the server rejects it with
       * `session.error: invalid_format` and then runs the whole call on defaults — empty system
       * prompt, NO GREETING, and the stock voice. Nothing else reports a problem, so a call would
       * have gone out with the AI disclosure silently missing. `output.voice` is the real field.
       *
       * Both identifier hints apply and they do different jobs, so we send both: `keyterms`
       * biases recognition toward this claim's reference numbers and rep names, and
       * `transcription_prompt` primes the same vocabulary as free text. An alphanumeric the STT
       * has never seen is precisely what it mishears, and a misheard reference number is a
       * fabricated fact in an appeal packet.
       */
      this.send({
        type: 'session.update',
        session: {
          system_prompt: config.systemPrompt,
          greeting: config.greeting,
          input: {
            keyterms: [...config.keyterms],
            transcription_prompt: config.keyterms.join(', '),
            turn_detection: { ...TURN_DETECTION },
            voice_focus: VOICE_FOCUS,
            voice_focus_threshold: VOICE_FOCUS_THRESHOLD,
            continuous_partials: true,
          },
          output: { voice: config.voice ?? 'alba' },
          // No `llm` key, deliberately. The server rejects BYO-LLM config on session.update
          // ("define it on a stored agent via POST /v1/agents"), and a rejected session.update
          // does not fail loudly — it drops the greeting and runs the call on defaults. Pinning
          // the model would mean managing a stored agent; the default is fine here because no
          // evidence-bearing sentence comes from the model. Our code assembles those.
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
    // Field names confirmed against the events reference (2026-09-22): transcript.user and
    // transcript.agent both carry `text`; reply.audio carries base64 PCM16 in `data`, NOT `audio`
    // — that one was guessed wrong and would have produced a silent agent on every live call.
    // `transcript` is kept as a fallback only; the documented field is `text`.
    const text = String(m.text ?? m.transcript ?? '');
    switch (m.type) {
      case 'session.ready':
        this.ready = true;
        // Kept so a dropped socket can be rejoined instead of losing the call. Storing it is
        // free; USING it is an explicit operator action (see `resume`), never automatic.
        this.resumeToken = typeof m.resume_token === 'string' ? m.resume_token : null;
        this.sessionId = typeof m.session_id === 'string' ? m.session_id : null;
        this.handlers.onReady?.(this.sessionId);
        break;
      case 'transcript.user':
        if (text.trim()) this.handlers.onUserTurn?.(text, at);
        break;
      case 'transcript.agent':
        if (text.trim()) this.handlers.onAgentTranscript?.(text);
        break;
      case 'reply.audio': {
        // The documented field is `data`. `audio` is accepted only so a field rename upstream
        // degrades to "still works" rather than "agent goes silent with no error anywhere".
        const chunk = typeof m.data === 'string' ? m.data : typeof m.audio === 'string' ? m.audio : null;
        if (chunk) this.handlers.onAudio?.(chunk, at);
        break;
      }
      case 'input.speech.started':
        this.handlers.onSpeechStarted?.();
        break;
      case 'reply.done':
        this.handlers.onReplyDone?.(m.status === 'interrupted');
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
  /**
   * The id needed to rejoin this session after a dropped socket, valid for about 30 seconds.
   * Null until session.ready. The server also returns a separate `resume_token`; `session.resume`
   * wants this one.
   */
  get resumable(): string | null {
    return this.sessionId;
  }

  /**
   * Rejoin a session whose socket dropped, keeping its conversation history.
   *
   * ONE explicit attempt, never a loop and never automatic. The account allows five new streams
   * a minute, and a reconnect-on-close loop is the fastest way to exhaust that — it then presents
   * as a connection bug rather than as the self-inflicted rate limit it is. A drop during a call
   * surfaces to the operator, who decides whether to rejoin.
   */
  resume(token: string, sessionId: string): void {
    if (this.socket) throw new Error('session already connected');
    const url = new URL(VOICE_AGENT_URL);
    url.searchParams.set('token', token);
    const ws = this.makeSocket(url.toString());
    this.socket = ws;
    this.openedAt = this.now();
    this.registry.register(this);
    ws.addEventListener('open', (() => {
      // `session_id`, not the separate `resume_token` the server also returns. `token` must be a
      // FRESH mint: tokens are single-use per session, and that includes a resume.
      this.send({ type: 'session.resume', session_id: sessionId });
    }) as never);
    ws.addEventListener('message', ((ev: { data: string }) => this.onMessage(ev.data)) as never);
    ws.addEventListener('error', (() => this.handlers.onError?.('socket error')) as never);
    ws.addEventListener('close', (() => this.finish('socket-closed')) as never);
  }

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
