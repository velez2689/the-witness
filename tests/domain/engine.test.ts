import { describe, expect, it } from 'vitest';
import { appendStatement, createLedger, type ClaimLedger } from '@/domain/claim-ledger';
import { detect, groupByTrigger, newContradictions } from '@/domain/engine';
import type { FactStatement, Statement } from '@/domain/statement';

const CLAIM = 'A-4471-08';
let n = 0;
function fact(over: Partial<FactStatement>): FactStatement {
  n += 1;
  return {
    kind: 'fact',
    id: `s${n}`,
    claimId: CLAIM,
    callId: 'call-x',
    capturedAt: '2026-07-08T15:02:00Z',
    speaker: { name: 'D. Reese', badge: '2210' },
    referenceNumber: null,
    span: { quote: 'q', startMs: 0, endMs: 1 },
    confidence: 'captured_confirmed',
    category: 'denial_reason',
    value: 'no prior authorization',
    ...over,
  };
}
function ledgerOf(...s: Statement[]): ClaimLedger {
  return s.reduce((l, x) => appendStatement(l, x), createLedger(CLAIM));
}

describe('value_conflict', () => {
  it('fires for a different reason in a different call, strongest when the badge matches', () => {
    const a = fact({ id: 'a', callId: 'call-02' });
    const b = fact({ id: 'b', callId: 'call-06', capturedAt: '2026-08-26T17:31:00Z', value: 'timely filing' });
    const [c] = detect(ledgerOf(a, b));
    expect(c.kind).toBe('value_conflict');
    expect(c.statementIds).toEqual(['a', 'b']);
    expect(c.sameBadge).toBe(true);
    expect(c.daysApart).toBe(49);
    expect(c.severity).toBeGreaterThan(80);
  });

  it('does NOT fire for a repeat of the same reason', () => {
    const a = fact({ id: 'a', callId: 'call-02' });
    const same = fact({ id: 'b', callId: 'call-05' });
    expect(detect(ledgerOf(a, same))).toEqual([]);
  });

  it('does NOT fire within a single call', () => {
    const x = fact({ id: 'x', callId: 'call-05' });
    const y = fact({ id: 'y', callId: 'call-05', value: 'timely filing' });
    expect(detect(ledgerOf(x, y))).toEqual([]);
  });

  it('does NOT fire when the later reason is an additional one ("also a diagnosis issue")', () => {
    const a = fact({ id: 'a', callId: 'call-05', value: 'timely filing' });
    const b = fact({ id: 'b', callId: 'call-06', value: 'diagnosis code', additional: true });
    expect(detect(ledgerOf(a, b))).toEqual([]);
  });

  it('never treats a refusal as a value conflict', () => {
    const a = fact({ id: 'a', callId: 'call-02' });
    const r: Statement = {
      kind: 'refusal',
      id: 'r',
      claimId: CLAIM,
      callId: 'call-03',
      capturedAt: '2026-07-22T18:37:00Z',
      speaker: null,
      referenceNumber: null,
      span: { quote: 'q', startMs: 0, endMs: 1 },
      confidence: 'not_captured',
      category: 'diagnosis_code',
    };
    expect(detect(ledgerOf(a, r))).toEqual([]);
  });
});

describe('existence_denial', () => {
  const ref = fact({
    id: 'ref',
    callId: 'call-04',
    capturedAt: '2026-08-05T14:19:00Z',
    category: 'reference_number',
    value: '8K2J-702',
    speaker: { name: 'T. Okafor', badge: '5182' },
  });
  it('fires when a Rep denies a call the ledger holds, citing the payer-issued reference', () => {
    const denial = fact({
      id: 'd',
      callId: 'call-06',
      capturedAt: '2026-08-26T17:31:00Z',
      category: 'existence_claim',
      value: 'no record of call',
      subjectDate: '2026-08-05',
    });
    const [c] = detect(ledgerOf(ref, denial));
    expect(c.kind).toBe('existence_denial');
    expect(c.statementIds).toEqual(['ref', 'd']);
    expect(c.severity).toBe(100);
  });
  it('does NOT fire for a date on which the ledger holds no call', () => {
    const denial = fact({
      id: 'd',
      callId: 'call-06',
      category: 'existence_claim',
      value: 'no record of call',
      subjectDate: '2026-08-06',
    });
    expect(detect(ledgerOf(ref, denial))).toEqual([]);
  });
});

describe('status_flip, commitment_violation, policy_inconsistency', () => {
  it('flags a status regression but not normal progress', () => {
    const r = fact({ id: 'r', callId: 'c4', category: 'status', value: 'reprocessed' });
    const d = fact({ id: 'd', callId: 'c5', category: 'status', value: 'denied' });
    expect(detect(ledgerOf(r, d)).map((c) => c.kind)).toEqual(['status_flip']);
    const p = fact({ id: 'p', callId: 'c1', category: 'status', value: 'in process' });
    const d2 = fact({ id: 'd2', callId: 'c2', category: 'status', value: 'denied' });
    expect(detect(ledgerOf(p, d2))).toEqual([]);
  });
  it('flags timely filing after being told to wait', () => {
    const w = fact({ id: 'w', callId: 'c1', category: 'commitment', value: 'wait 30 days', windowDays: 30 });
    const t = fact({ id: 't', callId: 'c5', value: 'timely filing', capturedAt: '2026-08-14T19:48:00Z' });
    expect(detect(ledgerOf(w, t)).map((c) => c.kind)).toContain('commitment_violation');
  });
  it('flags two reps stating different rules on one topic', () => {
    const a = fact({ id: 'a', callId: 'c1', category: 'policy', topic: 'timely filing limit', value: '90 days' });
    const b = fact({
      id: 'b',
      callId: 'c2',
      category: 'policy',
      topic: 'timely filing limit',
      value: '180 days',
      speaker: { name: 'S. Whitfield', badge: '3390' },
    });
    expect(detect(ledgerOf(a, b)).map((c) => c.kind)).toEqual(['policy_inconsistency']);
  });
});

describe('derivation invariants', () => {
  const a = fact({ id: 'a', callId: 'call-02' });
  const b = fact({ id: 'b', callId: 'call-06', capturedAt: '2026-08-26T17:31:00Z', value: 'timely filing' });
  it('is pure and recomputable from the log', () => {
    const l = ledgerOf(a, b);
    expect(detect(l)).toEqual(detect(l));
    expect(l.statements).toHaveLength(2);
  });
  it('reports only what a new statement adds, and groups by trigger worst-first', () => {
    const before = ledgerOf(a);
    const after = appendStatement(before, b);
    const added = newContradictions(before, after);
    expect(added).toHaveLength(1);
    expect(groupByTrigger(added)[0][0].kind).toBe('value_conflict');
  });
});
