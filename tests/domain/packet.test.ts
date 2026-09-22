import { describe, expect, it } from 'vitest';
import { appendStatement } from '@/domain/claim-ledger';
import { buildClaimUpdate } from '@/domain/claim-update';
import { detect } from '@/domain/engine';
import { chain, ledgerHash, verifyLedger } from '@/domain/integrity';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { runModeA, startModeA } from '@/domain/mode-a';
import { buildPacket, maskMember } from '@/domain/packet';
import { buildHistory } from '@/domain/script-runner';
import { sha256Hex } from '@/lib/sha256';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';
import { REP_BANK_CALL_06 } from '@fixtures/scripts/rep-bank-call-06';

const BRIEF: CallBrief = {
  claimId: CLAIM.id, payer: CLAIM.payer, providerName: 'Harbor Orthopedic Billing', patientLabel: CLAIM.patient,
  memberId: CLAIM.memberId, dateOfService: CLAIM.dateOfService, dxCodes: CLAIM.dxCodes, billed: CLAIM.billed,
  objectives: DEFAULT_OBJECTIVES,
};
const history = buildHistory(CLAIM.id, CALLS);
const done = runModeA(startModeA(history.ledger, BRIEF, { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt }, REP_BANK_CALL_06));
const ledger = done.session.ledger;

describe('sha256', () => {
  it('matches the known test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('tamper-evident ledger', () => {
  it('is deterministic and commits to every row', () => {
    expect(ledgerHash(ledger)).toBe(ledgerHash(ledger));
    expect(chain(ledger)).toHaveLength(ledger.statements.length);
  });
  it('detects an edited quote, a removed row and a reordering', () => {
    const good = ledgerHash(ledger);
    const edited = { ...ledger, statements: ledger.statements.map((s, i) => (i === 3 ? { ...s, span: { ...s.span, quote: 'altered' } } : s)) };
    const removed = { ...ledger, statements: ledger.statements.filter((_, i) => i !== 3) };
    const swapped = { ...ledger, statements: [ledger.statements[1], ledger.statements[0], ...ledger.statements.slice(2)] };
    expect(verifyLedger(edited, good)).toBe(false);
    expect(verifyLedger(removed, good)).toBe(false);
    expect(verifyLedger(swapped, good)).toBe(false);
    expect(verifyLedger(ledger, good)).toBe(true);
  });
  it('appending a new row changes the head hash but leaves earlier links intact', () => {
    const before = chain(ledger);
    const extra = appendStatement(ledger, { ...ledger.statements[0], id: 'stmt-extra' });
    const after = chain(extra);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(ledgerHash(extra)).not.toBe(ledgerHash(ledger));
  });
});

describe('appeal packet', () => {
  const packet = buildPacket(ledger, { claimId: CLAIM.id, payer: CLAIM.payer, memberId: CLAIM.memberId, dateOfService: CLAIM.dateOfService, billed: CLAIM.billed });
  it('masks the member ID to its last four characters', () => {
    expect(maskMember('MD77140228')).toBe('******0228');
    expect(packet.header.memberMasked).toBe('******0228');
    expect(JSON.stringify(packet)).not.toContain(CLAIM.memberId);
  });
  it('cites each payer statement with rep, badge, reference, date and an offset into the call', () => {
    const c = packet.citations.find((x) => x.value === 'timely filing' && x.date === 'Aug 26')!;
    expect(c.rep).toBe('D. Reese, badge 2210');
    expect(c.reference).toBe('8K2J-988');
    expect(c.offset).toMatch(/^\d\d:\d\d$/);
    expect(c.hash).toHaveLength(64);
  });
  it('records refusals as evidence, including the call where the rep would not identify', () => {
    expect(packet.refusals.length).toBeGreaterThanOrEqual(5);
    expect(packet.refusals.some((r) => r.rep === 'representative did not identify')).toBe(true);
  });
  it('lists the same-badge conflict first-class, 49 days apart', () => {
    const c = packet.conflicts.find((x) => x.kind === 'value conflict' && x.sameBadge)!;
    expect(c.daysApart).toBe(49);
    expect(c.earlier.quote).toMatch(/prior authorization/i);
    expect(c.later.value).toBe('timely filing');
  });
  it('carries the ledger hash that commits to the whole log', () => {
    expect(packet.ledgerHash).toBe(ledgerHash(ledger));
  });
});

describe('claim update sheet', () => {
  const update = buildClaimUpdate(ledger, LIVE_CALL.id, detect(ledger).filter((c) => c.statementIds[1].startsWith('stmt-call-06-')), done.holdSeconds);
  it('has a row for every field the Agent needs, traced to a statement', () => {
    const byField = Object.fromEntries(update.rows.map((r) => [r.field, r]));
    expect(byField['Representative'].value).toBe('D. Reese 2210');
    expect(byField['Call reference number']).toMatchObject({ value: '8K2J-988', state: 'confirmed' });
    expect(byField['Denial reason'].value).toBe('timely filing');
    expect(byField['Specific diagnosis code'].state).toBe('refused');
    expect(byField['Remark code'].state).toBe('refused');
    expect(update.rows.every((r) => r.state === 'missing' || r.statementId !== null)).toBe(true);
  });
  it('produces a plain-text note with statement ids for the PM claim-note field', () => {
    expect(update.note).toContain('claim A-4471-08');
    expect(update.note).toContain('[stmt-call-06-');
    expect(update.note).toContain('Hold time: 4m 2s');
  });
});
