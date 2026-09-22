import { appendStatement, type ClaimLedger } from './claim-ledger';
import type { Contradiction } from './contradiction';
import { newContradictions } from './engine';
import {
  classifyAsk,
  extractFromTurn,
  type AskKind,
  type Draft,
  type RepTurn,
} from './extractor';
import type { CallId, ClaimId, Speaker, Statement } from './statement';
import { findAlnumRuns, formatReference } from '@/lib/alphanumeric';

/**
 * One call in progress. Every function returns a NEW session; the ledger inside is append-only.
 * The Rep's words become statements here, in our code — the voice agent never writes.
 */
export interface CallSession {
  claimId: ClaimId;
  callId: CallId;
  capturedAt: string;
  nameHint: string | null;
  identity: { first: string | null; badge: string | null };
  askedFor: AskKind | null;
  /** Reference number the Agent has read back and is waiting on the Rep to confirm. */
  pendingReadback: string | null;
  /** Member IDs of everyone on this call (see call-roster). */
  memberIds: readonly string[];
  ledger: ClaimLedger;
  seq: number;
}

export interface IngestResult {
  session: CallSession;
  added: Statement[];
  contradictions: Contradiction[];
}

export function startCall(
  ledger: ClaimLedger,
  meta: { callId: CallId; capturedAt: string; nameHint?: string | null; memberIds?: readonly string[] },
): CallSession {
  return {
    claimId: ledger.claimId,
    callId: meta.callId,
    capturedAt: meta.capturedAt,
    nameHint: meta.nameHint ?? null,
    identity: { first: null, badge: null },
    askedFor: null,
    pendingReadback: null,
    memberIds: meta.memberIds ?? [],
    ledger,
    seq: 0,
  };
}

export function knownReps(ledger: ClaimLedger): Speaker[] {
  const seen = new Map<string, Speaker>();
  for (const s of ledger.statements) {
    if (s.speaker && s.speaker.badge) seen.set(s.speaker.badge, s.speaker);
  }
  return [...seen.values()];
}

function currentSpeaker(session: CallSession, name: string | null): Speaker | null {
  return name && session.identity.badge ? { name, badge: session.identity.badge } : null;
}

function isRepeat(session: CallSession, draft: Draft): boolean {
  return session.ledger.statements.some((s) => {
    if (s.callId !== session.callId || s.kind !== draft.kind || s.category !== draft.category) return false;
    if (s.kind === 'refusal' || draft.kind === 'refusal') return true;
    return s.value === draft.value && !s.confirms;
  });
}

const AFFIRM = /^(?:yes|yeah|yep|right|correct|that'?s (?:correct|right)|that is (?:correct|right))\b/i;

export function ingestRepTurn(session: CallSession, turn: RepTurn): IngestResult {
  const ext = extractFromTurn(turn, {
    capturedAt: session.capturedAt,
    identity: session.identity,
    askedFor: session.askedFor,
    knownReps: knownReps(session.ledger),
    nameHint: session.nameHint,
    knownMemberIds: session.memberIds,
  });

  let next: CallSession = {
    ...session,
    identity: { first: ext.identity.first, badge: ext.identity.badge },
    askedFor: null,
  };
  let ledger = session.ledger;
  const added: Statement[] = [];
  const speaker = currentSpeaker(next, ext.identity.name);

  const push = (statement: Statement): void => {
    ledger = appendStatement(ledger, statement);
    added.push(statement);
  };
  const base = (d: Draft) => {
    next = { ...next, seq: next.seq + 1 };
    return {
      id: `stmt-${next.callId}-${String(next.seq).padStart(2, '0')}`,
      claimId: next.claimId,
      callId: next.callId,
      capturedAt: next.capturedAt,
      // A Rep who has not identified themselves is unattributed. Never guessed.
      speaker,
      referenceNumber: null as string | null,
      span: d.span,
      confidence: d.confidence,
    };
  };

  for (const d of ext.drafts) {
    if (isRepeat({ ...next, ledger }, d)) continue;
    const b = base(d);
    if (d.kind === 'refusal') {
      push({ ...b, kind: 'refusal', category: d.category, speaker });
    } else {
      push({
        ...b,
        kind: 'fact',
        category: d.category,
        value: d.value,
        ...(d.topic ? { topic: d.topic } : {}),
        ...(d.additional ? { additional: true } : {}),
        ...(d.windowDays !== undefined ? { windowDays: d.windowDays } : {}),
        ...(d.subjectDate ? { subjectDate: d.subjectDate } : {}),
      });
    }
  }

  // Confirm a pending read-back when the Rep agrees. Append-only: a NEW row, the original stays.
  if (session.pendingReadback && AFFIRM.test(turn.text.trim())) {
    const original = ledger.statements.find(
      (s) => s.kind === 'fact' && s.category === 'reference_number' && s.value === session.pendingReadback,
    );
    if (original && original.kind === 'fact') {
      const b = base({ kind: 'fact', category: 'reference_number', value: original.value, span: {
        quote: turn.text, startMs: turn.startMs, endMs: turn.endMs }, confidence: 'captured_confirmed' });
      push({ ...b, kind: 'fact', category: 'reference_number', value: original.value, confirms: original.id,
        span: { quote: `${original.span.quote} / ${turn.text}`, startMs: original.span.startMs, endMs: turn.endMs } });
      next = { ...next, pendingReadback: null };
    }
  }

  next = { ...next, ledger };
  return { session: next, added, contradictions: newContradictions(session.ledger, ledger) };
}

/** Something the Agent (or the Witness in Mode A) said to the Rep. */
export function noteUsLine(session: CallSession, text: string): CallSession {
  const lastReasonWasDiagnosis = session.ledger.statements.some(
    (s) => s.callId === session.callId && s.kind === 'fact' && s.category === 'denial_reason' && s.value === 'diagnosis code',
  );
  const runs = findAlnumRuns(text).map((r) => formatReference(r.raw));
  const pending = runs.find((r) =>
    session.ledger.statements.some(
      (s) => s.callId === session.callId && s.kind === 'fact' && s.category === 'reference_number' && s.value === r && !s.confirms,
    ),
  );
  return {
    ...session,
    askedFor: classifyAsk(text, lastReasonWasDiagnosis),
    pendingReadback: pending ?? session.pendingReadback,
  };
}

/**
 * Close the call. A read-back the Rep never objected to is confirmed — the Agent repeated the
 * number and nobody corrected it before hang-up. Rep silence is not agreement for a NEW read-back
 * in a live call (that waits for the Rep), so this only runs for archived calls.
 */
export function endArchivedCall(session: CallSession): IngestResult {
  const original = session.pendingReadback
    ? session.ledger.statements.find(
        (s) => s.kind === 'fact' && s.category === 'reference_number' && s.value === session.pendingReadback && !s.confirms,
      )
    : undefined;
  if (!original || original.kind !== 'fact') return { session, added: [], contradictions: [] };
  const seq = session.seq + 1;
  const row: Statement = {
    ...original,
    id: `stmt-${session.callId}-${String(seq).padStart(2, '0')}`,
    confidence: 'captured_confirmed',
    confirms: original.id,
  };
  const ledger = appendStatement(session.ledger, row);
  return { session: { ...session, ledger, seq, pendingReadback: null }, added: [row], contradictions: [] };
}
