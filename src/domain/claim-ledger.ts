import type { ClaimId, CallId, Statement } from './statement';

/**
 * Append-only. The history IS the product — there is no update or delete here,
 * only append and read. A statement is keyed to its claim at capture time and is
 * never moved or overwritten.
 */
export interface ClaimLedger {
  readonly claimId: ClaimId;
  readonly statements: readonly Statement[];
}

export function createLedger(claimId: ClaimId): ClaimLedger {
  return { claimId, statements: [] };
}

export function appendStatement(ledger: ClaimLedger, statement: Statement): ClaimLedger {
  if (statement.claimId !== ledger.claimId) {
    throw new Error(
      `statement claim "${statement.claimId}" does not match ledger claim "${ledger.claimId}"`,
    );
  }
  return { claimId: ledger.claimId, statements: [...ledger.statements, statement] };
}

export function statementsForCall(ledger: ClaimLedger, callId: CallId): readonly Statement[] {
  return ledger.statements.filter((s) => s.callId === callId);
}
