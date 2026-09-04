import type { ClaimId } from './statement';

/**
 * The five contradiction types. Only four are evidenced in docs/PROJECT-STATE.md
 * and the demo corpus (fixtures/scripts/claim-A-4471-08.md):
 *   - value_conflict: same question, different answers (e.g. denial reason changes).
 *   - existence_denial: a rep denies a previously recorded event happened, contradicted
 *     by the ledger (e.g. call 06 denying call 04 occurred despite its reference number).
 *   - status_flip: a status changes with no stated reason (e.g. "reprocessed" then later
 *     "denied" with no explanation of what changed).
 *   - commitment_violation: an earlier payer instruction is violated by a later outcome
 *     (e.g. told to wait 30 days, then denied for taking that long).
 * A fifth kind remains unconfirmed — flagged for Chris, not guessed at here.
 */
export type ContradictionKind =
  | 'value_conflict'
  | 'existence_denial'
  | 'status_flip'
  | 'commitment_violation';

export interface Contradiction {
  id: string;
  claimId: ClaimId;
  kind: ContradictionKind;
  /** The statements in conflict, earlier first. */
  statementIds: readonly [string, string];
  detectedAt: string;
}
