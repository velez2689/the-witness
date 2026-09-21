import type { ClaimLedger } from './claim-ledger';
import type { Contradiction } from './contradiction';
import { callReference } from './speech';
import type { CallId, FactStatement, Statement } from './statement';
import { shortDate } from '@/lib/dates';

/**
 * Everything the Agent needs to update the claim, each field traced to a statement row.
 * Missing fields stay missing (loud); refusals are recorded as refusals. Nothing is inferred.
 */
export interface UpdateRow {
  field: string;
  value: string;
  state: 'confirmed' | 'unconfirmed' | 'refused' | 'missing';
  statementId: string | null;
  quote: string | null;
}

export interface ClaimUpdate {
  claimId: string;
  callId: CallId;
  rows: UpdateRow[];
  /** Plain-text note for the practice-management claim-note field. */
  note: string;
}

const REFUSAL_LABEL: Record<string, string> = {
  rep_identity: 'Rep identity',
  diagnosis_code: 'Specific diagnosis code',
  remark_code: 'Remark code',
  reference_number: 'Reference number',
};

function lastFact(ledger: ClaimLedger, callId: CallId, pred: (f: FactStatement) => boolean): FactStatement | undefined {
  return [...ledger.statements].reverse().find((s): s is FactStatement => s.callId === callId && s.kind === 'fact' && pred(s));
}

export function buildClaimUpdate(
  ledger: ClaimLedger,
  callId: CallId,
  contradictions: readonly Contradiction[],
  holdSeconds: number,
): ClaimUpdate {
  const rows: UpdateRow[] = [];
  const row = (field: string, s: Statement | undefined, value: string, state: UpdateRow['state']) =>
    rows.push({ field, value, state, statementId: s?.id ?? null, quote: s?.span.quote ?? null });

  const ident = lastFact(ledger, callId, (f) => f.category === 'rep_identity');
  if (ident) row('Representative', ident, ident.value, ident.confidence === 'captured_confirmed' ? 'confirmed' : 'unconfirmed');
  else row('Representative', undefined, 'not captured', 'missing');

  const ref = callReference(ledger, callId);
  if (ref) row('Call reference number', ref, ref.value, ref.confirms !== undefined || ref.confidence === 'captured_confirmed' ? 'confirmed' : 'unconfirmed');
  else row('Call reference number', undefined, 'not captured', 'missing');

  const status = lastFact(ledger, callId, (f) => f.category === 'status');
  if (status) row('Claim status', status, status.value, 'confirmed');
  else row('Claim status', undefined, 'not captured', 'missing');

  const reasons = ledger.statements.filter((s): s is FactStatement => s.callId === callId && s.kind === 'fact' && s.category === 'denial_reason');
  reasons.forEach((r, i) => row(i === 0 ? 'Denial reason' : 'Additional reason', r, r.value, 'confirmed'));
  if (reasons.length === 0) row('Denial reason', undefined, 'not captured', 'missing');

  for (const r of ledger.statements.filter((s) => s.callId === callId && s.kind === 'refusal')) {
    row(REFUSAL_LABEL[r.category] ?? r.category.replace(/_/g, ' '), r, 'not provided: the rep declined to specify', 'refused');
  }

  const commitment = lastFact(ledger, callId, (f) => f.category === 'commitment');
  if (commitment) row('Payer commitment', commitment, commitment.value, 'confirmed');

  const conflicts = contradictions.filter((c) => c.statementIds[1].startsWith(`stmt-${callId}-`));
  for (const c of conflicts) {
    const earlier = ledger.statements.find((s) => s.id === c.statementIds[0]);
    if (!earlier) continue;
    const label = c.kind.replace(/_/g, ' ');
    row(`Contradiction: ${label}`, earlier, `contradicts ${shortDate(earlier.capturedAt)}, ${earlier.speaker?.name ?? 'unidentified rep'}${earlier.speaker ? ` badge ${earlier.speaker.badge}` : ''}`, 'confirmed');
  }

  const when = ledger.statements.find((s) => s.callId === callId)?.capturedAt ?? '';
  const lines = [
    `${when ? shortDate(when) : ''} call on claim ${ledger.claimId}. Every line below traces to a timestamped quote on file.`,
    ...rows.map((r) => `- ${r.field}: ${r.value}${r.state === 'unconfirmed' ? ' (unconfirmed)' : ''}${r.state === 'missing' ? ' (NOT CAPTURED)' : ''}${r.statementId ? ` [${r.statementId}]` : ''}`),
    holdSeconds > 0 ? `- Hold time: ${Math.floor(holdSeconds / 60)}m ${holdSeconds % 60}s` : '',
  ].filter(Boolean);
  return { claimId: ledger.claimId, callId, rows, note: lines.join('\n') };
}
