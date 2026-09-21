import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detect, groupByTrigger } from '@/domain/engine';
import { buildHistory, replayCall } from '@/domain/script-runner';
import type { Statement } from '@/domain/statement';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';

const GOLDEN = path.resolve(import.meta.dirname, '../../fixtures/golden/claim-A-4471-08.json');

function essence(s: Statement) {
  return {
    id: s.id,
    kind: s.kind,
    category: s.category,
    value: s.kind === 'fact' ? s.value : null,
    speaker: s.speaker ? `${s.speaker.name} ${s.speaker.badge}` : null,
    confidence: s.confidence,
    confirms: s.kind === 'fact' ? (s.confirms ?? null) : null,
    subjectDate: s.kind === 'fact' ? (s.subjectDate ?? null) : null,
  };
}

const history = buildHistory(CLAIM.id, CALLS);
const live = replayCall(history.ledger, LIVE_CALL);

describe('demo corpus: claim A-4471-08 replayed through the real pipeline', () => {
  it('matches the golden statement log (UPDATE_GOLDEN=1 to regenerate)', () => {
    const actual = live.ledger.statements.map(essence);
    if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('captures the reason mutation across calls 02, 03, 05 with the right speakers', () => {
    const reasons = live.ledger.statements.filter(
      (s) => s.kind === 'fact' && s.category === 'denial_reason' && !s.additional,
    );
    expect(reasons.map((s) => (s.kind === 'fact' ? s.value : ''))).toEqual([
      'no prior authorization',
      'diagnosis code',
      'timely filing',
      'timely filing',
    ]);
    expect(reasons[0].speaker?.badge).toBe('2210');
    expect(reasons[3].speaker?.badge).toBe('2210');
  });

  it('records call 03 as three attributable refusals, not blanks', () => {
    const c3 = history.ledger.statements.filter((s) => s.callId === 'call-03' && s.kind === 'refusal');
    expect(c3.map((s) => s.category).sort()).toEqual(['diagnosis_code', 'reference_number', 'rep_identity']);
    expect(c3.every((s) => s.speaker === null)).toBe(true);
  });

  it('holds a payer-issued reference number for every call that gave one', () => {
    const refs = history.ledger.statements
      .filter((s) => s.kind === 'fact' && s.category === 'reference_number' && !s.confirms)
      .map((s) => (s.kind === 'fact' ? s.value : ''));
    expect(refs).toEqual(['8K2J-114', '8K2J-338', '8K2J-702', '8K2J-915']);
  });

  it('confirms a reference number only by appending a new row; the original stays', () => {
    const original = live.ledger.statements.find((s) => s.id === 'stmt-call-06-08');
    const confirmation = live.ledger.statements.find((s) => s.kind === 'fact' && s.confirms === 'stmt-call-06-08');
    expect(original?.confidence).toBe('captured_unconfirmed');
    expect(confirmation?.confidence).toBe('captured_confirmed');
  });

  it('fires exactly the demo flags on the live call, in order, with the strongest fact first', () => {
    const groups = groupByTrigger(live.contradictions);
    expect(groups.map((g) => g[0].kind).sort()).toEqual(['existence_denial', 'value_conflict']);
    const value = live.contradictions.find((c) => c.kind === 'value_conflict')!;
    expect(value.statementIds[0]).toBe('stmt-call-02-03');
    expect(value.sameBadge).toBe(true);
    expect(value.daysApart).toBe(49);
    const existence = live.contradictions.find((c) => c.kind === 'existence_denial')!;
    expect(existence.statementIds[0]).toBe('stmt-call-04-05');
    const commitment = live.contradictions.find((c) => c.kind === 'commitment_violation')!;
    expect(commitment.daysApart).toBe(84);
  });

  it('records the live call refusals (diagnosis code, remark code) as first-class rows', () => {
    const refusals = live.added.filter((s) => s.kind === 'refusal').map((s) => s.category);
    expect(refusals).toEqual(['diagnosis_code', 'remark_code']);
  });

  it('is recomputable: contradictions equal a fresh derivation from the ledger', () => {
    const fresh = detect(live.ledger).filter((c) => c.statementIds[1].startsWith('stmt-call-06'));
    expect(fresh.map((c) => c.id).sort()).toEqual(live.contradictions.map((c) => c.id).sort());
  });

  it('never quotes a payer statement it did not capture: every span has text and ordered offsets', () => {
    for (const s of live.ledger.statements) {
      expect(s.span.quote.length).toBeGreaterThan(0);
      expect(s.span.endMs).toBeGreaterThanOrEqual(s.span.startMs);
    }
  });
});
