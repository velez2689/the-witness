import type { CallBrief } from '@/domain/call-brief';
import type { ClaimLedger } from '@/domain/claim-ledger';
import { initialPlan, nextMove, type Move, type PlanState } from '@/domain/call-plan';
import { ingestRepTurn, noteUsLine, startCall, type CallSession } from '@/domain/call-session';
import type { Contradiction } from '@/domain/contradiction';
import { detect } from '@/domain/engine';
import { estimateDurationMs } from '@/domain/script';
import { checkSpeech, consentGreeting } from '@/domain/speech';
import type { Statement } from '@/domain/statement';
import { SessionRegistry } from './session-registry';
import { VoiceAgentSession, type SocketFactory } from './voice-agent-session';

/**
 * Mode A on the real Voice Agent API: a person plays the Rep (their voice goes in), the Witness
 * conducts the call from the deterministic plan (its assembled lines go out via reply.create).
 * ONE session, on the Rep's audio only, so who-said-what is structural, never diarized.
 */
export interface LiveEvents {
  status(s: 'connecting' | 'live' | 'closed' | 'error', detail?: string): void;
  rep(e: { text: string; added: Statement[]; contradictions: Contradiction[]; engineMs: number; atMs: number }): void;
  witness(e: { text: string; cites: readonly string[]; tag: string; atMs: number }): void;
  latency(e: { flagMs: number; speakMs: number | null }): void;
  /** The agent said something with an alphanumeric that is not in the record. */
  drift(unknown: string[]): void;
  done(reason: string): void;
}

export interface LiveDeps {
  brief: CallBrief;
  ledger: ClaimLedger;
  call: { callId: string; capturedAt: string; repSurname?: string | null };
  registry: SessionRegistry;
  fetchToken: () => Promise<string>;
  startMic: (onChunk: (b64: string) => void) => Promise<{ stop(): void }>;
  playAudio: (b64: string) => void;
  stopAudio: () => void;
  /** True while the Witness is audibly speaking, so the microphone can be held closed. */
  isSpeaking?: () => boolean;
  events: LiveEvents;
  makeSocket?: SocketFactory;
  now?: () => number;
}

/**
 * Written to make the model's UNHEARD turn as short as possible.
 *
 * The server answers every finalized Rep turn with its own LLM and offers no way to switch that
 * off. None of it is played - VoiceAgentSession drops any reply we did not ask for - but our own
 * line waits for it to finish so the two never overlap, so every word it generates is pure delay
 * before the Witness speaks. Asking for one word instead of "one short polite sentence" is worth
 * roughly a second on every turn.
 */
const SYSTEM_PROMPT =
  'You are a silent transcription assistant. Never volunteer information, questions or facts. ' +
  'When you are given an explicit instruction to say something, say exactly that and nothing else. ' +
  'Otherwise reply with the single word: Okay.';

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
  private mic: { stop(): void } | null = null;
  private startedAt = 0;
  private spokeAt: number | null = null;
  private pendingClose = false;
  private lastFlagMs = 0;
  private turnAt: number | null = null;

  constructor(private readonly d: LiveDeps) {
    this.session = startCall(d.ledger, { callId: d.call.callId, capturedAt: d.call.capturedAt, nameHint: d.call.repSurname ?? null });
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  /** Explicit user action only. Mints a fresh single-use token, then connects. */
  async start(): Promise<void> {
    this.d.events.status('connecting');
    let token: string;
    try {
      token = await this.d.fetchToken();
    } catch (e) {
      this.d.events.status('error', e instanceof Error ? e.message : 'could not get a session token');
      return;
    }
    this.startedAt = this.now();
    const greeting = consentGreeting(this.d.brief);
    this.voice = new VoiceAgentSession(
      this.d.registry,
      {
        onReady: () => void this.onReady(greeting.text),
        onUserTurn: (text, at) => this.onRepTurn(text, at),
        onAgentTranscript: (text) => {
          const check = checkSpeech(text, this.session.ledger, this.d.brief);
          if (!check.ok) this.d.events.drift(check.unknown);
        },
        onAudio: (b64, at) => {
          if (this.spokeAt !== null) {
            this.d.events.latency({ flagMs: this.lastFlagMs, speakMs: at - this.spokeAt });
            this.spokeAt = null;
          }
          this.d.playAudio(b64);
        },
        /*
         * NOT a place to stop playback. input.speech.started fires whenever the server's VAD
         * hears anything on the input - including the Witness's own voice arriving back through
         * the microphone. Flushing here meant every syllable it spoke could cut off the rest of
         * its own sentence, which is heard as a call breaking up. The server already owns
         * barge-in (interrupt_response is on); it reports a real interruption on reply.done.
         */
        onSpeechStarted: () => undefined,
        onReplyDone: (interrupted) => {
          // A genuine barge-in: drop whatever is still queued so stale speech does not play on.
          if (interrupted) this.d.stopAudio();
          if (this.pendingClose) this.closeWhenSilent();
        },
        onError: (m) => this.d.events.status('error', m),
        onClosed: (reason) => {
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

  private async onReady(greetingText: string): Promise<void> {
    // The greeting is spoken by the session itself; the plan just records that it happened.
    const first = nextMove(this.plan, this.d.brief, this.session.ledger, this.d.call.callId, []);
    this.plan = first.state;
    this.session = noteUsLine(this.session, greetingText);
    this.d.events.witness({ text: greetingText, cites: [], tag: 'greet', atMs: 0 });
    this.d.events.status('live');
    try {
      /*
       * Hold the microphone closed while the Witness speaks. Without this its own voice comes
       * back through the microphone on any machine using speakers, is transcribed as the Rep,
       * and the call plan ends up answering itself - which presents as the Witness repeating
       * the same question and never hearing the person actually talking.
       *
       * The cost is barge-in on speakers: interrupting mid-sentence needs headphones, where
       * hardware echo cancellation does the job properly and nothing is gated.
       */
      this.mic = await this.d.startMic((b64) => {
        if (this.d.isSpeaking?.()) return;
        this.voice?.sendAudio(b64);
      });
    } catch (e) {
      this.d.events.status('error', e instanceof Error ? `microphone: ${e.message}` : 'microphone unavailable');
      this.stop('mic-denied');
    }
  }

  private onRepTurn(text: string, receivedAt: number): void {
    const atMs = receivedAt - this.startedAt;
    this.turnAt = receivedAt;
    const p0 = performance.now();
    const r = ingestRepTurn(this.session, { text, startMs: atMs, endMs: atMs + estimateDurationMs(text) });
    const contradictions = detect(r.session.ledger);
    const engineMs = performance.now() - p0;
    this.lastFlagMs = engineMs;
    this.session = r.session;
    this.d.events.rep({ text, added: r.added, contradictions: r.contradictions, engineMs, atMs });

    const { move, state } = nextMove(this.plan, this.d.brief, this.session.ledger, this.d.call.callId, contradictions);
    this.plan = state;
    this.speak(move, atMs + 400);
  }

  private speak(move: Move, atMs: number): void {
    if (!move.line) {
      this.stop('plan-complete');
      return;
    }
    this.session = noteUsLine(this.session, move.line.text);
    // Latency is measured from the END of the Rep's turn to the first audible syllable.
    this.spokeAt = this.turnAt ?? this.now();
    this.voice?.say(move.line.text);
    this.d.events.witness({ text: move.line.text, cites: move.line.cites, tag: move.key, atMs });
    if (move.kind === 'alert_agent' || move.kind === 'close' || move.kind === 'recap') this.pendingClose = true;
  }

  /**
   * Hang up only once the last line has actually been HEARD.
   *
   * `reply.done` means the server finished sending the audio, not that it finished playing: at
   * that moment the closing line is still sitting in the playback buffer. Closing there cut the
   * Witness off part-way through its own sign-off - a saved call showed the recap starting at
   * 198.7s and the session ending at 210.5s, mid-sentence. The tester heard it stop speaking,
   * again, for a different reason than last time.
   *
   * Polled rather than driven by an event because the buffer is owned by the player, and bounded
   * so a wedged player can never keep a billed session open.
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
    this.mic?.stop();
    this.voice?.close(reason);
  }
}
