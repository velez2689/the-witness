import type { CallBrief } from './call-brief';
import { endArchivedCall, ingestRepTurn, noteUsLine, startCall, type CallSession } from './call-session';
import { nextMove, initialPlan, type Move, type MoveKey, type PlanState } from './call-plan';
import type { Contradiction } from './contradiction';
import { detect } from './engine';
import { estimateDurationMs, type ScriptLine } from './script';
import type { ClaimLedger } from './claim-ledger';
import type { Statement } from './statement';

/**
 * Mode A: the Witness conducts the call. The Rep here is a Rep Simulator (scripted, deterministic)
 * or, in the browser, a live person / a recorded track — the same `ingestRepTurn` path either way.
 */

/** Rep lines keyed by the Witness move that provokes them. Data lives in fixtures/. */
export type RepBank = Readonly<Record<MoveKey, ScriptLine>>;

export type CallEvent =
  | { type: 'witness'; move: Move; text: string; cites: readonly string[]; atMs: number }
  | {
      type: 'rep';
      line: ScriptLine;
      atMs: number;
      added: Statement[];
      contradictions: Contradiction[];
      /** Real time spent extracting, diffing and planning for this turn (not network). */
      engineMs: number;
    };

export interface ModeAState {
  brief: CallBrief;
  session: CallSession;
  plan: PlanState;
  bank: RepBank;
  clockMs: number;
  holdSeconds: number;
  events: CallEvent[];
}

const FALLBACK: ScriptLine = { who: 'REP', text: 'Can you repeat that?' };

export function startModeA(
  ledger: ClaimLedger,
  brief: CallBrief,
  call: { callId: string; capturedAt: string; repSurname?: string | null },
  bank: RepBank,
): ModeAState {
  return {
    brief,
    session: startCall(ledger, { callId: call.callId, capturedAt: call.capturedAt, nameHint: call.repSurname ?? null }),
    plan: initialPlan(),
    bank,
    clockMs: 0,
    holdSeconds: 0,
    events: [],
  };
}

/** One Witness move followed by the Rep's answer to it. Returns the same state once the call is over. */
export function stepModeA(state: ModeAState): { state: ModeAState; finished: boolean } {
  if (state.plan.done) return { state, finished: true };
  const { move, state: plan } = nextMove(
    state.plan,
    state.brief,
    state.session.ledger,
    state.session.callId,
    detect(state.session.ledger),
  );
  const events: CallEvent[] = [...state.events];
  let session = state.session;
  let clock = state.clockMs;
  let hold = state.holdSeconds;

  if (move.line) {
    events.push({ type: 'witness', move, text: move.line.text, cites: move.line.cites, atMs: clock });
    session = noteUsLine(session, move.line.text);
    clock += estimateDurationMs(move.line.text);
  }
  if (move.kind === 'close' || move.kind === 'alert_agent' || move.kind === 'wait') {
    const closed = endArchivedCall(session);
    return {
      state: { ...state, plan, session: closed.session, clockMs: clock, holdSeconds: hold, events },
      finished: true,
    };
  }

  const line = state.bank[move.key] ?? FALLBACK;
  if (line.holdBeforeSeconds) hold += line.holdBeforeSeconds;
  const startMs = clock;
  const endMs = startMs + estimateDurationMs(line.text);
  const t0 = performance.now();
  const r = ingestRepTurn(session, { text: line.text, startMs, endMs, lowConfidence: line.lowConfidence });
  const engineMs = performance.now() - t0;
  events.push({ type: 'rep', line, atMs: startMs, added: r.added, contradictions: r.contradictions, engineMs });
  return {
    state: { ...state, plan, session: r.session, clockMs: endMs, holdSeconds: hold, events },
    finished: plan.done,
  };
}

/** Run the whole call. A safety cap keeps a plan bug from looping forever. */
export function runModeA(initial: ModeAState, maxSteps = 40): ModeAState {
  let state = initial;
  for (let i = 0; i < maxSteps; i += 1) {
    const r = stepModeA(state);
    state = r.state;
    if (r.finished) break;
  }
  return state;
}
