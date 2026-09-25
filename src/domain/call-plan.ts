import type { ClaimLedger } from './claim-ledger';
import type { CallBrief, ObjectiveKey } from './call-brief';
import { canHangUp, computeGate } from './capture-gate';
import type { Contradiction } from './contradiction';
import { groupByTrigger } from './engine';
import * as speech from './speech';
import type { Utterance } from './speech';
import type { CallId, FactStatement } from './statement';

/**
 * The call plan is a deterministic state machine. NO LLM decides what to ask or what to say:
 * the next move is a pure function of (plan state, brief, ledger). The Witness speaks the
 * `line` in Mode A; in Mode B the same move is whispered to the Agent as `whisper`.
 */

export type MoveKind =
  | 'greet'
  | 'identify'
  | 'verify'
  | 'challenge'
  | 'probe_prior'
  | 'ask'
  | 'reference'
  | 'readback'
  | 'recap'
  | 'close'
  | 'alert_agent'
  | 'wait';

/** Stable key the Rep Simulator (and tests) branch on. */
export type MoveKey = string;

export interface Move {
  kind: MoveKind;
  key: MoveKey;
  line: Utterance | null;
  whisper: Utterance | null;
}

export interface PlanState {
  /** How many times each move key has been made. */
  moves: Readonly<Record<MoveKey, number>>;
  /** Contradiction trigger statement ids already challenged. */
  challenged: readonly string[];
  done: boolean;
  /** Set when the plan cannot proceed alone: the Agent should Take Over. */
  needsAgent: string | null;
}

export const MAX_CHALLENGES = 2;
const MAX_ASKS = 2;

export function initialPlan(): PlanState {
  return { moves: {}, challenged: [], done: false, needsAgent: null };
}

function bump(state: PlanState, key: MoveKey, extra: Partial<PlanState> = {}): PlanState {
  return { ...state, ...extra, moves: { ...state.moves, [key]: (state.moves[key] ?? 0) + 1 } };
}

const count = (s: PlanState, key: MoveKey) => s.moves[key] ?? 0;

function callFacts(ledger: ClaimLedger, callId: CallId): FactStatement[] {
  return ledger.statements.filter((s): s is FactStatement => s.callId === callId && s.kind === 'fact');
}
function hasRefusal(ledger: ClaimLedger, callId: CallId, category: string): boolean {
  return ledger.statements.some((s) => s.callId === callId && s.kind === 'refusal' && s.category === category);
}

/** Is this objective active and still unanswered in this call? */
function objectivePending(
  key: ObjectiveKey,
  ledger: ClaimLedger,
  callId: CallId,
  state: PlanState,
): boolean {
  const facts = callFacts(ledger, callId);
  if (count(state, `ask:${key}`) >= MAX_ASKS) return false;
  switch (key) {
    case 'claim_status':
      return !facts.some((f) => f.category === 'status');
    case 'denial_reason':
      return !facts.some((f) => f.category === 'denial_reason' && !f.additional);
    case 'remit_reason':
      // The remit may say something the Rep has not: ask once, after the first reason is known.
      return count(state, 'ask:remit_reason') === 0 && facts.some((f) => f.category === 'denial_reason');
    case 'specific_code':
      return (
        facts.some((f) => f.category === 'denial_reason' && f.value === 'diagnosis code') &&
        !hasRefusal(ledger, callId, 'diagnosis_code') &&
        count(state, 'ask:specific_code') === 0
      );
    case 'remark_code':
      return hasRefusal(ledger, callId, 'diagnosis_code') && !hasRefusal(ledger, callId, 'remark_code') && count(state, 'ask:remark_code') === 0;
    default:
      return count(state, `ask:${key}`) === 0;
  }
}

/** A prior call whose recorded status the Rep has not been asked to confirm: worth verifying once. */
function priorStatusToProbe(ledger: ClaimLedger, callId: CallId): FactStatement | undefined {
  const current = [...callFacts(ledger, callId)].reverse().find((f) => f.category === 'status');
  if (!current) return undefined;
  const prior = ledger.statements
    .filter((s): s is FactStatement => s.kind === 'fact' && s.category === 'status' && s.callId !== callId)
    .reverse()
    .find((s) => s.value !== current.value && speech.callReference(ledger, s.callId) !== undefined);
  return prior;
}

/**
 * Decide the next move after a Rep turn (or at the start of the call). `contradictions` are all
 * contradictions the ledger currently derives; only those raised by this call are acted on.
 */
export function nextMove(
  state: PlanState,
  brief: CallBrief,
  ledger: ClaimLedger,
  callId: CallId,
  contradictions: readonly Contradiction[],
): { move: Move; state: PlanState } {
  const gate = computeGate(ledger, callId, brief.objectives);
  const item = (key: string) => gate.find((g) => g.key === key)!;
  const say = (
    kind: MoveKind,
    key: MoveKey,
    line: Utterance | null,
    whisper: Utterance | null = line,
    next: PlanState = bump(state, key),
  ) => ({ move: { kind, key, line, whisper } as Move, state: next });

  if (state.done) return { move: { kind: 'wait', key: 'wait', line: null, whisper: null }, state };

  // 0 · Greeting — verbatim, AI + recording disclosure, asks for name and badge.
  if (count(state, 'greet') === 0) {
    return say('greet', 'greet', speech.consentGreeting(brief), speech.whisperMissing('Rep name and badge'));
  }

  // 1 · Identity: one re-ask, then carry on (a refusal is recorded by the extractor).
  if (item('rep_name').state === 'missing' && count(state, 'identify') < 1) {
    return say('identify', 'identify', speech.askIdentityAgain(), speech.whisperMissing('Rep name and badge'));
  }

  // 2 · Contradictions raised by THIS call preempt everything else. Worst first, capped.
  if (state.challenged.length < MAX_CHALLENGES) {
    const mine = contradictions.filter((c) => c.statementIds[1].startsWith(`stmt-${callId}-`));
    for (const group of groupByTrigger(mine)) {
      const trigger = group[0].statementIds[1];
      if (state.challenged.includes(trigger)) continue;
      const c = group[0];
      return say(
        'challenge',
        `challenge:${c.kind}`,
        speech.challenge(ledger, c),
        speech.whisperFor(ledger, c),
        bump(state, `challenge:${c.kind}`, { challenged: [...state.challenged, trigger] }),
      );
    }
  }

  // 3 · Verify the claim and ask for status (once).
  if (count(state, 'verify') === 0) {
    return say('verify', 'verify', speech.verifyClaim(brief), speech.whisperMissing('Claim status'));
  }

  // 4 · Ask the Rep to confirm a prior call the ledger holds (once). This is what surfaces an existence denial.
  if (count(state, 'probe_prior') === 0) {
    const prior = priorStatusToProbe(ledger, callId);
    if (prior) {
      return say('probe_prior', 'probe_prior', speech.probePriorCall(ledger, prior.id));
    }
  }

  // 5 · Objectives, in the Agent's order.
  for (const key of brief.objectives) {
    if (objectivePending(key, ledger, callId, state)) {
      return say('ask', `ask:${key}`, speech.askObjective(key));
    }
  }

  // 6 · Reference number: capture, then read back until the Rep confirms.
  const ref = item('reference_number');
  if (ref.state === 'missing') {
    if (count(state, 'ask:reference_number') < MAX_ASKS) {
      return say('reference', 'ask:reference_number', speech.askReference(), speech.whisperMissing('Reference number'));
    }
    return alert(state, 'No reference number after two requests. Take over and ask for one before hanging up.');
  }
  if (ref.state === 'unconfirmed' && ref.value) {
    if (count(state, 'readback') < MAX_ASKS) {
      return say('readback', 'readback', speech.readback(ref.value), speech.whisperReadback(ref.value));
    }
    return alert(state, 'The reference number is still unconfirmed. Take over and have the Rep repeat it.');
  }

  // 7 · Gate satisfied: recap, then close.
  if (canHangUp(gate)) {
    if (count(state, 'recap') === 0) {
      return say('recap', 'recap', speech.closeOutForRep(ledger, callId));
    }
    // A close move used to carry no line, and a move with no line is the live call's signal to
    // hang up - so the Witness ended every successful call by going silent mid-conversation.
    return {
      move: { kind: 'close', key: 'close', line: speech.signOff(), whisper: null },
      state: bump(state, 'close', { done: true }),
    };
  }
  return alert(state, 'Required fields are still missing. Take over before hanging up.');
}

function alert(state: PlanState, reason: string): { move: Move; state: PlanState } {
  return {
    move: {
      kind: 'alert_agent',
      key: 'alert_agent',
      line: speech.handOff(),
      whisper: { text: reason, cites: [] },
    },
    state: bump(state, 'alert_agent', { needsAgent: reason, done: true }),
  };
}
