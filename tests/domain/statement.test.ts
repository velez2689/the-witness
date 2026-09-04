import { describe, expect, it } from 'vitest';
import type { FactStatement, RefusalStatement } from '@/domain/statement';

describe('FactStatement', () => {
  it('carries a speaker, a reference number, and the value it asserts', () => {
    const statement: FactStatement = {
      kind: 'fact',
      id: 'stmt-call06-denial-reason',
      claimId: 'A-4471-08',
      callId: 'call-06',
      capturedAt: '2026-08-26T13:31:00Z',
      speaker: { name: 'D. Reese', badge: '2210' },
      referenceNumber: '8K2J-988',
      span: { quote: 'Okay. That claim denied. Timely filing.', startMs: 242_000, endMs: 245_500 },
      confidence: 'captured_confirmed',
      category: 'denial_reason',
      value: 'timely filing',
    };

    expect(statement.kind).toBe('fact');
    expect(statement.speaker?.badge).toBe('2210');
    expect(statement.value).toBe('timely filing');
  });
});

describe('RefusalStatement', () => {
  it('is a first-class row, not a blank field, when the payer names a category but withholds the value', () => {
    const refusal: RefusalStatement = {
      kind: 'refusal',
      id: 'stmt-call03-refusal-diagnosis',
      claimId: 'A-4471-08',
      callId: 'call-03',
      capturedAt: '2026-07-22T14:37:00Z',
      speaker: null,
      referenceNumber: null,
      span: { quote: "it's denying on a diagnosis code", startMs: 0, endMs: 0 },
      confidence: 'not_captured',
      category: 'diagnosis code',
    };

    expect(refusal.kind).toBe('refusal');
    expect(refusal.category).toBe('diagnosis code');
    // A refusal is the absence of a value, not the absence of the row.
    expect('value' in refusal).toBe(false);
  });

  it('allows a fully anonymous refusal (call 03: no rep name, no reference number)', () => {
    const refusal: RefusalStatement = {
      kind: 'refusal',
      id: 'stmt-call03-refusal-reference',
      claimId: 'A-4471-08',
      callId: 'call-03',
      capturedAt: '2026-07-22T14:37:00Z',
      speaker: null,
      referenceNumber: null,
      span: { quote: 'you should have gotten a letter', startMs: 0, endMs: 0 },
      confidence: 'not_captured',
      category: 'reference number',
    };

    expect(refusal.speaker).toBeNull();
    expect(refusal.referenceNumber).toBeNull();
  });
});
