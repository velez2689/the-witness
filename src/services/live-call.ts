import type { CallBrief } from '@/domain/call-brief';
import type { ClaimLedger } from '@/domain/claim-ledger';
import { initialPlan, nextMove, type Move, type PlanState } from '@/domain/call-plan';
import { ingestRepTurn, noteUsLine, startCall, type CallSession } from '@/domain/call-session';
import type { Contradiction } from '@/domain/contradiction';
import { detect } from '@/domain/engine';
import { estimateDurationMs } from '@/domain/script';
import { checkSpeech, consentGreeting } from '@/domain/speech';
import type { Statement } from '@/domain/statement';
import { SAMPLE_RATE } from './audio-io';
import { SessionRegistry } from './session-registry';
import { StreamingSession, type StreamingSocketFactory, type TurnTiming } from './streaming-session';
import { VoiceAgentSession, type SocketFactory } from './voice-agent-session';

/**
 * Mode A, split across two sockets: Streaming STT hears the Rep, the Voice Agent speaks for the
 * Witness, and the deterministic plan sits between them.
 *
 * It was one socket doing both jobs, which is the obvious arrangement and the wrong one. The Voice
 * Agent answers every finalized user turn with its own LLM and offers no way to disable that, so
 * our assembled line had to queue behind an unheard model turn to stop the two playing at once,
 * a measured median of 3.2 seconds of dead air after every answer, worst case 8.6. Feeding the
 * Rep's audio to a transcription-only socket removes the user turn from the Voice Agent entirely:
 * it never volunteers a reply, so there is nothing to wait for. Spiked before building: 409 ms to
 * first audible word, and zero unsolicited replies across a full session.
 *
 * Who-said-what stays structural, never diarized: the Rep is whoever the microphone hears, the
 * Witness is only ever what our code assembled. Two sockets per call is the ceiling the account's
 * five-new-streams-per-minute limit allows, and both are registered and closed together.
 */

/** Socket-level happenings, recorded into the saved call so a failure names its own cause. */
export type TraceKind =
  | 'reply-started'
  | 'reply-done'
  | 'suppressed'
  | 'transcript-agent'
  | 'session-error'
  | 'stt-begin'
  | 'stt-partial'
  | 'stt-error'
  | 'socket-closed'
  | 'interrupted';

export interface LiveEvents {
  status(s: 'connecting' | 'live' | 'closed' | 'error', detail?: string): void;
  rep(e: {
    text: string;
    added: Statement[];
    contradictions: Contradiction[];
    engineMs: number;
    atMs: number;
    /** Where the turn sits in the audio the server heard, when it sent word timings. */
    audio?: { startMs: number; endMs: number };
  }): void;
  witness(e: { text: string; cites: readonly string[]; tag: string; atMs: number }): void;
  /**
   * `flagMs` is end of the Rep's turn to the flag, from the server's word timings, or null when
   * the turn carried none; `engineMs` is extract, diff and plan alone. Never smoothed.
   */
  latency(e: { flagMs: number | null; engineMs: number; speakMs: number | null }): void;
  /** The agent said something with an alphanumeric that is not in the record. */
  drift(unknown: string[]): void;
  done(reason: string): void;
  trace?(kind: TraceKind, detail?: string): void;
}

/**
 * How the operator is listening. On speakers the Witness's own voice returns through the
 * microphone, so the microphone is held closed while it speaks and the Rep cannot interrupt. On
 * headphones there is nothing to gate, and gating only loses the Rep's first words when they
 * answer before the Witness has finished, which reads as the Witness asking the same question
 * again. The choice is explicit because nothing in the browser can tell the two apart.
 */
export type AudioSetup = 'headphones' | 'speakers';

export interface LiveDeps {
  brief: CallBrief;
  ledger: ClaimLedger;
  call: { callId: string; capturedAt: string; repSurname?: string | null };
  registry: SessionRegistry;
  /** `agent` mints for the Voice Agent (the mouth), `stt` for Streaming (the ears). */
  fetchToken: (kind: 'agent' | 'stt') => Promise<string>;
  startMic: (onChunk: (pcm: Int16Array) => void) => Promise<{ stop(): void }>;
  playAudio: (b64: string) => void;
  stopAudio: () => void;
  /** True while the Witness is audibly speaking, so the microphone can be held closed on speakers. */
  isSpeaking?: () => boolean;
  audioSetup?: AudioSetup;
  events: LiveEvents;
  makeSocket?: SocketFactory;
  makeSttSocket?: StreamingSocketFactory;
  now?: () => number;
}

/**
 * Sent to the Voice Agent socket, which never receives audio in this arrangement, so the model
 * never gets a user turn to answer. Kept as the guard rail it was written to be: if a regression
 * ever feeds that socket audio again, the model's turn is one word rather than a paragraph.
 */
const SYSTEM_PROMPT =
  'You are a silent transcription assistant. Never volunteer information, questions or facts. ' +
  'When you are given an explicit instruction to say something, say exactly that and nothing else. ' +
  'Otherwise reply with the single word: Okay.';

/**
 * Transcription socket settings for a payer call. Values are from the Streaming v3 API reference
 * (read 2026-09-29). `max_turn_silence` defaults to 1536 ms and forces a turn to end on silence
 * regardless of punctuation; a rep reading "Eight-K-two-J... nine-eight-eight" pauses longer than
 * that, and the recording of 2026-09-25 16:24 shows the badge number arriving as "Badge number 2."
 * with the rest of the digits never forming a turn. The reference's own example for identifiers
 * split across turns raises it to 2000 with the speculative check at 400.
 */
export const STT_SETTINGS = {
  speechModel: 'universal-3-5-pro',
  maxTurnSilenceMs: 2000,
  minTurnSilenceMs: 400,
  voiceFocus: 'near-field' as const,
  inactivityTimeoutSeconds: 120,
};

/**
 * How long the Witness waits for an answer to its recap before signing off on its own. The recap
 * ends with a question; a Rep who has already said goodbye or gone quiet must not keep a billed
 * session open, and a call that ends with no sign-off reads as a dropped line.
 */
export const RECAP_SILENCE_MS = 8_000;

/**
 * Does this partial transcript mean the Rep is genuinely talking over the Witness?
 *
 * Cutting the Witness off is destructive, the rest of the sentence is discarded, so the bar is
 * deliberately higher than "the microphone heard something". A single word is what a cough, a
 * keyboard, a back-channel "mm-hm" or a syllable of the Witness's own voice leaking past the
 * gate all look like, and treating any of those as a barge-in is what made the Witness clip
 * itself mid-greeting.
 */
export function isRealInterruption(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words.length < 2) return false;
  // "Uh-huh", "okay", "mm-hm": agreement, not an interruption. The server used to make this
  // same distinction for us; it cannot any more, because it is no longer the one speaking.
  const BACK_CHANNEL = /^(uh|um|mm|hmm|mhm|uh-huh|mm-hm|yeah|yep|yes|okay|ok|right|sure|got it)$/i;
  return words.some((w) => !BACK_CHANNEL.test(w.replace(/[^a-z0-9-]/gi, '')));
}

export function keytermsFor(brief: CallBrief, ledger: ClaimLedger): string[] {
  const terms = new Set<string>([brief.claimId, brief.memberId, brief.payer, ...brief.dxCodes]);
  for (const s of ledger.statements) {
    if (s.kind === 'fact' && (s.category === 'reference_number' || s.category === 'rep_identity')) terms.add(s.value);
    if (s.speaker) terms.add(s.speaker.badge);
  }
  return [...terms];
}

export class LiveCall {
  private session: CallSession;
  private plan: PlanState = initialPlan();
  private voice: VoiceAgentSession | null = null;
  private ears: StreamingSession | null = null;
  private mic: { stop(): void } | null = null;
  private startedAt = 0;
  private spokeAt: number | null = null;
  private pendingClose = false;
  private awaitingRecapAnswer = false;
  private recapTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlagMs: number | null = null;
  private lastEngineMs = 0;
  private turnAt: number | null = null;

  constructor(private readonly d: LiveDeps) {
    this.session = startCall(d.ledger, { callId: d.call.callId, capturedAt: d.call.capturedAt, nameHint: d.call.repSurname ?? null });
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private trace(kind: TraceKind, detail?: string): void {
    this.d.events.trace?.(kind, detail);
  }

  /** Explicit user action only. Mints a fresh single-use token, then connects. */
  async start(): Promise<void> {
    this.d.events.status('connecting');
    let token: string;
    let sttToken: string;
    try {
      // Both tokens are minted before either socket opens: a call that can speak but cannot hear
      // is worse than one that never started, and the failure has to surface before the greeting.
      [token, sttToken] = await Promise.all([this.d.fetchToken('agent'), this.d.fetchToken('stt')]);
    } catch (e) {
      this.d.events.status('error', e instanceof Error ? e.message : 'could not get a session token');
      return;
    }
    this.startedAt = this.now();
    const greeting = consentGreeting(this.d.brief);
    this.voice = new VoiceAgentSession(
      this.d.registry,
      {
        onReady: () => void this.onReady(greeting.text, sttToken),
        // No audio is ever sent to this socket, so it never produces a user turn. Kept wired so a
        // regression that starts feeding it audio is visible as a doubled turn, not as silence.
        onUserTurn: (text, at) => this.onRepTurn(text, at),
        onAgentTranscript: (text) => {
          this.trace('transcript-agent', text);
          const check = checkSpeech(text, this.session.ledger, this.d.brief);
          if (!check.ok) this.d.events.drift(check.unknown);
        },
        onSuppressed: (text) => this.trace('suppressed', text),
        onReplyStarted: (ours) => this.trace('reply-started', ours ? 'ours' : 'model'),
        onReplyEnded: (ours, status) => this.trace('reply-done', ours ? `ours ${status}` : status.startsWith('muted') ? status : `model ${status}`),
        onAudio: (b64, at) => {
          if (this.spokeAt !== null) {
            this.d.events.latency({ flagMs: this.lastFlagMs, engineMs: this.lastEngineMs, speakMs: at - this.spokeAt });
            this.spokeAt = null;
          }
          this.d.playAudio(b64);
        },
        /*
         * NOT a place to stop playback. input.speech.started fires whenever the server's VAD
         * hears anything on the input, including the Witness's own voice arriving back through
         * the microphone. Flushing here meant every syllable it spoke could cut off the rest of
         * its own sentence, which is heard as a call breaking up.
         */
        onSpeechStarted: () => undefined,
        onReplyDone: (interrupted) => {
          // A genuine barge-in: drop whatever is still queued so stale speech does not play on.
          if (interrupted) this.d.stopAudio();
          if (this.pendingClose) this.closeWhenSilent();
          else if (this.awaitingRecapAnswer) this.armRecapFallback();
        },
        onError: (m) => {
          this.trace('session-error', m);
          this.d.events.status('error', m);
        },
        onClosed: (reason) => {
          this.trace('socket-closed', `voice ${reason}`);
          this.mic?.stop();
          this.d.events.status('closed', reason);
          this.d.events.done(reason);
        },
      },
      this.d.makeSocket,
      this.d.now,
    );
    this.voice.connect(token, {
      systemPrompt: SYSTEM_PROMPT,
      greeting: greeting.text,
      keyterms: keytermsFor(this.d.brief, this.d.ledger),
    });
  }

  private async onReady(greetingText: string, sttToken: string): Promise<void> {
    // The greeting is spoken by the session itself; the plan just records that it happened.
    const first = nextMove(this.plan, this.d.brief, this.session.ledger, this.d.call.callId, []);
    this.plan = first.state;
    this.session = noteUsLine(this.session, greetingText);
    this.d.events.witness({ text: greetingText, cites: [], tag: 'greet', atMs: 0 });
    this.d.events.status('live');
    try {
      this.ears = new StreamingSession(
        this.d.registry,
        {
          onReady: (id) => this.trace('stt-begin', id ?? undefined),
          onTurn: (text, at, timing) => this.onRepTurn(text, at, timing),
          /*
           * Barge-in is ours now. The Voice Agent owned it while it could hear the Rep; a
           * transcription socket cannot interrupt anything, because it is not the one speaking.
           * A partial means the Rep has started talking, so the Witness stops: the player is
           * flushed AND the rest of the reply is muted, because the server keeps streaming it
           * (there is no cancel event) and a flush alone let the sentence resume a moment later.
           */
          onPartial: (text) => {
            this.trace('stt-partial', text.slice(0, 40));
            if (this.d.isSpeaking?.() && isRealInterruption(text)) {
              this.d.stopAudio();
              this.voice?.muteCurrent();
              this.trace('interrupted', text);
            }
          },
          onError: (m) => {
            this.trace('stt-error', m);
            this.d.events.status('error', m);
          },
          onClosed: (reason) => {
            this.trace('socket-closed', `stt ${reason}`);
            this.mic?.stop();
          },
        },
        this.d.makeSttSocket,
        this.d.now,
      );
      this.ears.connect(sttToken, {
        sampleRate: SAMPLE_RATE,
        keyterms: keytermsFor(this.d.brief, this.d.ledger),
        ...STT_SETTINGS,
      });

      /*
       * The microphone is held closed while the Witness speaks ONLY on speakers, where its own
       * voice would otherwise come back through the microphone, be transcribed as the Rep, and
       * make the call plan answer itself. On headphones nothing is gated: the Rep may interrupt,
       * and an answer that starts before the Witness finishes is not lost.
       */
      const gate = this.d.audioSetup === 'speakers';
      this.mic = await this.d.startMic((pcm) => {
        if (gate && this.d.isSpeaking?.()) return;
        this.ears?.sendAudio(pcm);
      });
    } catch (e) {
      this.d.events.status('error', e instanceof Error ? `microphone: ${e.message}` : 'microphone unavailable');
      this.stop('mic-denied');
    }
  }

  private onRepTurn(text: string, receivedAt: number, timing?: TurnTiming): void {
    this.awaitingRecapAnswer = false;
    this.clearRecapTimer();
    const atMs = receivedAt - this.startedAt;
    // The end of the Rep's turn is what latency is measured from. The transcript arrives after
    // the server's end-of-turn wait, so `receivedAt` alone would flatter the figure.
    this.turnAt = timing ? timing.endOfTurnWall : receivedAt;
    // Statement offsets come from the server's word timings when it sends them (offsets into
    // the audio we sent, which is what the saved recording holds); otherwise estimated.
    const span = timing
      ? { startMs: timing.startMs, endMs: timing.endMs }
      : { startMs: atMs, endMs: atMs + estimateDurationMs(text) };
    const p0 = performance.now();
    const r = ingestRepTurn(this.session, { text, ...span });
    const contradictions = detect(r.session.ledger);
    const engineMs = performance.now() - p0;
    this.lastEngineMs = engineMs;
    this.lastFlagMs = timing ? this.now() - timing.endOfTurnWall : null;
    this.session = r.session;
    this.d.events.rep({ text, added: r.added, contradictions: r.contradictions, engineMs, atMs, audio: timing ? span : undefined });
    if (r.contradictions.length > 0) {
      this.d.events.latency({ flagMs: this.lastFlagMs, engineMs, speakMs: null });
    }

    const { move, state } = nextMove(this.plan, this.d.brief, this.session.ledger, this.d.call.callId, contradictions, {
      lastRepText: text,
      identity: this.session.identity,
    });
    this.plan = state;
    this.speak(move, atMs + 400);
  }

  private speak(move: Move, atMs: number): void {
    // A wait is the plan holding its turn (the Rep is mid-answer); the call goes on.
    if (move.kind === 'wait') return;
    if (!move.line) {
      this.stop('plan-complete');
      return;
    }
    this.session = noteUsLine(this.session, move.line.text);
    // Latency is measured from the END of the Rep's turn to the first audible syllable.
    this.spokeAt = this.turnAt ?? this.now();
    this.voice?.say(move.line.text);
    this.d.events.witness({ text: move.line.text, cites: move.line.cites, tag: move.key, atMs });
    /*
     * The recap ends with a question ("does that all sound right?") and the plan's next move is
     * the sign-off, so the recap must NOT close the call: it used to, which hung up on the Rep
     * mid-answer and meant the sign-off was never heard on a live call. Only the sign-off and
     * the hand-off end the session.
     */
    if (move.kind === 'alert_agent' || move.kind === 'close') this.pendingClose = true;
    if (move.kind === 'recap') this.awaitingRecapAnswer = true;
  }

  /** After the recap has been heard, give the Rep a moment to answer; then sign off regardless. */
  private armRecapFallback(): void {
    this.clearRecapTimer();
    this.recapTimer = setTimeout(() => {
      this.recapTimer = null;
      if (!this.awaitingRecapAnswer) return;
      this.awaitingRecapAnswer = false;
      const { move, state } = nextMove(this.plan, this.d.brief, this.session.ledger, this.d.call.callId, []);
      this.plan = state;
      this.speak(move, this.now() - this.startedAt);
    }, RECAP_SILENCE_MS);
  }

  private clearRecapTimer(): void {
    if (this.recapTimer) clearTimeout(this.recapTimer);
    this.recapTimer = null;
  }

  /**
   * Hang up only once the last line has actually been HEARD.
   *
   * `reply.done` means the server finished sending the audio, not that it finished playing: at
   * that moment the closing line is still sitting in the playback buffer. Closing there cut the
   * Witness off part-way through its own sign-off. Polled rather than driven by an event because
   * the buffer is owned by the player, and bounded so a wedged player can never keep a billed
   * session open.
   */
  private closeWhenSilent(waited = 0): void {
    const STEP = 250;
    const LIMIT = 15_000;
    if (waited < LIMIT && this.d.isSpeaking?.()) {
      setTimeout(() => this.closeWhenSilent(waited + STEP), STEP);
      return;
    }
    this.stop('plan-complete');
  }

  /** Every exit path: user Stop, plan done, error, timeout, page exit (the registry also closes on those). */
  stop(reason: string): void {
    this.clearRecapTimer();
    this.awaitingRecapAnswer = false;
    this.mic?.stop();
    // Both sockets, always. Each is billed on how long it stays open, so closing one and leaking
    // the other is the same bill as leaking both.
    this.ears?.close(reason);
    this.voice?.close(reason);
  }
}
