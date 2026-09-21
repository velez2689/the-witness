import { createLedger, type ClaimLedger } from './claim-ledger';
import type { Contradiction } from './contradiction';
import { endArchivedCall, ingestRepTurn, noteUsLine, startCall, type CallSession } from './call-session';
import { timeLines, type ScriptCall } from './script';
import type { ClaimId, Statement } from './statement';

export interface ReplayResult {
  ledger: ClaimLedger;
  session: CallSession;
  added: Statement[];
  contradictions: Contradiction[];
}

/** Replays an archived scripted call into a ledger, exactly as a live call would be ingested. */
export function replayCall(ledger: ClaimLedger, call: ScriptCall): ReplayResult {
  let session = startCall(ledger, {
    callId: call.id,
    capturedAt: call.startedAt,
    nameHint: call.repSurname,
  });
  const added: Statement[] = [];
  const contradictions: Contradiction[] = [];
  for (const line of timeLines(call.lines)) {
    if (line.who === 'US') {
      session = noteUsLine(session, line.text);
      continue;
    }
    const r = ingestRepTurn(session, {
      text: line.text,
      startMs: line.startMs,
      endMs: line.endMs,
      lowConfidence: line.lowConfidence,
    });
    session = r.session;
    added.push(...r.added);
    contradictions.push(...r.contradictions);
  }
  const closed = endArchivedCall(session);
  session = closed.session;
  added.push(...closed.added);
  return { ledger: session.ledger, session, added, contradictions };
}

/** Builds the claim's history from archived calls, oldest first. */
export function buildHistory(claimId: ClaimId, calls: readonly ScriptCall[]): ReplayResult {
  let ledger = createLedger(claimId);
  const added: Statement[] = [];
  const contradictions: Contradiction[] = [];
  let session = startCall(ledger, { callId: 'none', capturedAt: '' });
  for (const call of calls) {
    const r = replayCall(ledger, call);
    ledger = r.ledger;
    session = r.session;
    added.push(...r.added);
    contradictions.push(...r.contradictions);
  }
  return { ledger, session, added, contradictions };
}
