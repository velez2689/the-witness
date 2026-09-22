import type { ClaimLedger } from './claim-ledger';
import { OBJECTIVES, type ObjectiveKey } from './call-brief';
import type { CallId, FactStatement, Statement } from './statement';

/** confirmed / unconfirmed / missing / refused. Never a percentage. */
export type FieldState = 'confirmed' | 'unconfirmed' | 'missing' | 'refused';

export interface GateItem {
  key: string;
  label: string;
  state: FieldState;
  value: string | null;
  statementId: string | null;
  required: boolean;
}

function facts(ledger: ClaimLedger, callId: CallId): FactStatement[] {
  return ledger.statements.filter((s): s is FactStatement => s.callId === callId && s.kind === 'fact');
}
function refused(ledger: ClaimLedger, callId: CallId, category: string): Statement | undefined {
  return ledger.statements.find((s) => s.callId === callId && s.kind === 'refusal' && s.category === category);
}

/** Latest row wins; a confirmation row (confirms=...) upgrades the field without touching the original. */
function fieldFor(rows: FactStatement[]): { state: FieldState; row: FactStatement } | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  const confirmed = rows.some((r) => r.confirms !== undefined || r.confidence === 'captured_confirmed');
  return { state: confirmed ? 'confirmed' : 'unconfirmed', row: last };
}

/**
 * The before-you-hang-up gate: an EXIT CONDITION, not a status display. Required items must be
 * captured (confirmed or unconfirmed) or explicitly refused before the call may end.
 */
export function computeGate(
  ledger: ClaimLedger,
  callId: CallId,
  objectives: readonly ObjectiveKey[],
  /**
   * Who the rep said they were on this call, captured against ANOTHER claim worked on the same
   * call. Identity is a property of the CALL, not of the claim: one rep answers the line, and they
   * say their name once, not once per patient. Passing the real row here lets this claim's gate
   * clear while its ledger stays strictly what was said about THIS claim — the alternative,
   * copying the row into every ledger, would put a quote in claim B timestamped from before
   * claim B was ever mentioned, which is indistinguishable from fabricated evidence in a packet.
   */
  callIdentity?: FactStatement | null,
): GateItem[] {
  const all = facts(ledger, callId);
  const items: GateItem[] = [];

  const own = all.filter((f) => f.category === 'rep_identity');
  const identity = fieldFor(own.length > 0 ? own : callIdentity ? [callIdentity] : []);
  const identityRefused = refused(ledger, callId, 'rep_identity');
  const parts = identity ? identity.row.value.split(' ') : [];
  const badge = parts.length ? parts[parts.length - 1] : null;
  const name = parts.length > 1 ? parts.slice(0, -1).join(' ') : null;
  const idState: FieldState = identity ? identity.state : identityRefused ? 'refused' : 'missing';
  items.push({ key: 'rep_name', label: 'Rep name', state: idState, value: name, statementId: identity?.row.id ?? null, required: true });
  items.push({ key: 'rep_badge', label: 'Rep badge', state: idState, value: badge, statementId: identity?.row.id ?? null, required: true });

  const ref = fieldFor(all.filter((f) => f.category === 'reference_number'));
  items.push({
    key: 'reference_number',
    label: 'Reference number',
    state: ref ? ref.state : refused(ledger, callId, 'reference_number') ? 'refused' : 'missing',
    value: ref?.row.value ?? null,
    statementId: ref?.row.id ?? null,
    required: true,
  });

  for (const key of objectives) {
    const label = OBJECTIVES[key].label;
    let field: ReturnType<typeof fieldFor> = null;
    let refusalCategory: string | null = null;
    if (key === 'claim_status') field = fieldFor(all.filter((f) => f.category === 'status'));
    else if (key === 'denial_reason') field = fieldFor(all.filter((f) => f.category === 'denial_reason' && !f.additional));
    else if (key === 'remit_reason') {
      // Only a SECOND reason (or a refusal) answers "what does the remit say": a repeat of the first does not.
      const reasons = all.filter((f) => f.category === 'denial_reason');
      field = reasons.length >= 2 ? fieldFor(reasons) : null;
    }
    else if (key === 'specific_code') refusalCategory = 'diagnosis_code';
    else if (key === 'remark_code') refusalCategory = 'remark_code';
    const isRefused = refusalCategory ? refused(ledger, callId, refusalCategory) : undefined;
    items.push({
      key,
      label,
      state: field ? field.state : isRefused ? 'refused' : 'missing',
      value: field?.row.value ?? null,
      statementId: field?.row.id ?? isRefused?.id ?? null,
      required: false,
    });
  }
  return items;
}

/** True when every required field is captured or refused. Objectives never block hang-up on their own. */
export function canHangUp(items: readonly GateItem[]): boolean {
  return items.filter((i) => i.required).every((i) => i.state !== 'missing');
}
