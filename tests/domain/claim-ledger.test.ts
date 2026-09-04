import { describe, expect, it } from 'vitest';
import { appendStatement, createLedger, statementsForCall } from '@/domain/claim-ledger';
import type { FactStatement, RefusalStatement } from '@/domain/statement';

const CLAIM_ID = 'A-4471-08';

function factStatement(overrides: Partial<FactStatement>): FactStatement {
  return {
    kind: 'fact',
    id: 'stmt-default',
    claimId: CLAIM_ID,
    callId: 'call-default',
    capturedAt: '2026-01-01T00:00:00Z',
    speaker: { name: 'D. Reese', badge: '2210' },
    referenceNumber: '8K2J-338',
    span: { quote: '', startMs: 0, endMs: 0 },
    confidence: 'captured_confirmed',
    category: 'denial_reason',
    value: 'no prior authorization',
    ...overrides,
  };
}

// Call 02, Jul 08 — statement A: "denied, no prior authorization on file".
const call02Statement = factStatement({
  id: 'stmt-call02-denial-reason',
  callId: 'call-02',
  capturedAt: '2026-07-08T11:02:00Z',
  referenceNumber: '8K2J-338',
});

// Call 05, Aug 14 — statement B: "denied for timely filing". Conflicts with call02.
const call05Statement = factStatement({
  id: 'stmt-call05-denial-reason',
  callId: 'call-05',
  capturedAt: '2026-08-14T15:48:00Z',
  speaker: { name: 'S. Whitfield', badge: '3390' },
  referenceNumber: '8K2J-915',
  value: 'timely filing',
});

// Call 03, Jul 22 — the rep declines to identify and gives no reference number.
const call03Refusal: RefusalStatement = {
  kind: 'refusal',
  id: 'stmt-call03-refusal-diagnosis',
  claimId: CLAIM_ID,
  callId: 'call-03',
  capturedAt: '2026-07-22T14:37:00Z',
  speaker: null,
  referenceNumber: null,
  span: { quote: "it's denying on a diagnosis code", startMs: 0, endMs: 0 },
  confidence: 'not_captured',
  category: 'diagnosis code',
};

describe('createLedger', () => {
  it('starts empty for the given claim', () => {
    const ledger = createLedger(CLAIM_ID);
    expect(ledger.claimId).toBe(CLAIM_ID);
    expect(ledger.statements).toEqual([]);
  });
});

describe('appendStatement', () => {
  it('is append-only: returns a new ledger and never mutates the original', () => {
    const empty = createLedger(CLAIM_ID);
    const withCall02 = appendStatement(empty, call02Statement);

    expect(empty.statements).toHaveLength(0);
    expect(withCall02.statements).toHaveLength(1);
    expect(withCall02.statements[0]).toBe(call02Statement);
  });

  it('preserves capture order across calls, including a refusal with no rep or reference', () => {
    let ledger = createLedger(CLAIM_ID);
    ledger = appendStatement(ledger, call02Statement);
    ledger = appendStatement(ledger, call03Refusal);
    ledger = appendStatement(ledger, call05Statement);

    expect(ledger.statements.map((s) => s.id)).toEqual([
      call02Statement.id,
      call03Refusal.id,
      call05Statement.id,
    ]);
    expect(ledger.statements[1].speaker).toBeNull();
    expect(ledger.statements[1].confidence).toBe('not_captured');
  });

  it('refuses a statement keyed to a different claim', () => {
    const ledger = createLedger(CLAIM_ID);
    const wrongClaim = factStatement({ claimId: 'A-9999-00' });

    expect(() => appendStatement(ledger, wrongClaim)).toThrowError(/does not match ledger claim/);
  });
});

describe('statementsForCall', () => {
  it('filters the ledger down to one call without touching the rest', () => {
    let ledger = createLedger(CLAIM_ID);
    ledger = appendStatement(ledger, call02Statement);
    ledger = appendStatement(ledger, call05Statement);

    expect(statementsForCall(ledger, 'call-02')).toEqual([call02Statement]);
    expect(statementsForCall(ledger, 'call-99')).toEqual([]);
  });
});
