import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { initialPlan, nextMove, type PlanState } from '@/domain/call-plan';
import { ingestRepTurn, noteUsLine, startCall } from '@/domain/call-session';
import { computeGate } from '@/domain/capture-gate';
import { createLedger } from '@/domain/claim-ledger';
import { buildClaimUpdate } from '@/domain/claim-update';
import { detect } from '@/domain/engine';
import { extractFromTurn, type ExtractContext } from '@/domain/extractor';
import { closeOutForAgent, closeOutForRep } from '@/domain/speech';
import { CLAIM_STATUS, RARC, claimStatusCode, normalizeRemarkCode, remarkCode } from '@/domain/x12-codes';
import { findSpokenCodes } from '@/lib/spoken-codes';

const BRIEF: CallBrief = {
  claimId: 'claim-md5',
  payer: 'Meridian',
  providerName: 'Harbor Orthopedic Billing',
  patientLabel: 'Patient B',
  memberId: 'MD5583-0417',
  dateOfService: '2026-06-02',
  dxCodes: ['M54.5'],
  billed: 410,
  objectives: DEFAULT_OBJECTIVES,
};
const ctx = (over: Partial<ExtractContext> = {}): ExtractContext => ({
  capturedAt: '2026-09-29T14:00:00Z',
  identity: { first: null, badge: null },
  askedFor: null,
  knownReps: [],
  nameHint: null,
  ...over,
});
const turn = (text: string) => ({ text, startMs: 0, endMs: 1000 });

describe('the X12 code tables: identifiers only', () => {
  it('holds the remark and claim status code identifiers, with deactivated ones flagged', () => {
    expect(Object.keys(RARC).length).toBeGreaterThan(1000);
    expect(Object.keys(CLAIM_STATUS).length).toBeGreaterThan(700);
    expect(remarkCode('N30')).toMatchObject({ known: true, active: true });
    expect(remarkCode('MA130')).toMatchObject({ known: true });
    expect(remarkCode('N9999')).toMatchObject({ known: false });
    expect(claimStatusCode('21')).toMatchObject({ known: true });
    expect(Object.values(RARC).some(([active]) => active === 0)).toBe(true);
    expect(normalizeRemarkCode('n 30')).toBe('N30');
    expect(normalizeRemarkCode('MA-130')).toBe('MA130');
    expect(normalizeRemarkCode('CO-50')).toBeNull();
  });

  it('ships no description text: every data field is a code, a flag or a bucket word', () => {
    const src = readFileSync('src/domain/x12-codes.ts', 'utf8');
    const dataLines = src.split('\n').filter((l) => /^\s{2}'?[A-Z0-9]+'?: \[/.test(l));
    expect(dataLines.length).toBeGreaterThan(1900);
    for (const l of dataLines) {
      expect(l).toMatch(/^\s{2}'?[A-Z0-9]{1,6}'?: \[[01], '[a-z_]{1,24}'\],$/);
    }
  });
});

describe('codes as a Rep says them', () => {
  it('hears remark, claim status and CARC codes in their spoken and written forms', () => {
    const cases: [string, { kind: string; code: string }[]][] = [
      ['The remark code is N thirty.', [{ kind: 'remark', code: 'N30' }]],
      ['N three zero.', [{ kind: 'remark', code: 'N30' }]],
      ['Remark code M A one thirty.', [{ kind: 'remark', code: 'MA130' }]],
      ['It shows n30 and ma-130.', [{ kind: 'remark', code: 'N30' }, { kind: 'remark', code: 'MA130' }]],
      ['Claim status code twenty one.', [{ kind: 'status', code: '21' }]],
      ['The claim status is 21.', [{ kind: 'status', code: '21' }]],
      ['Denied CO fifty.', [{ kind: 'carc', code: 'CO-50' }]],
      ['It is CO-50 with remark N130.', [{ kind: 'carc', code: 'CO-50' }, { kind: 'remark', code: 'N130' }]],
      ['P R two oh four.', [{ kind: 'carc', code: 'PR-204' }]],
      ['I will send a form in the mail.', []],
      ['Badge number 2267.', []],
    ];
    for (const [text, want] of cases) expect(findSpokenCodes(text), text).toEqual(want);
  });

  it('files a listed code as confirmed and an unlisted or CARC code as unconfirmed', () => {
    const facts = (t: string) => extractFromTurn(turn(t), ctx()).drafts.filter((d) => d.kind === 'fact');
    expect(facts('Remark code N thirty.')).toMatchObject([{ category: 'remark_code', value: 'N30', confidence: 'captured_confirmed' }]);
    expect(facts('Remark code N nine nine nine.')).toMatchObject([{ category: 'remark_code', value: 'N999', confidence: 'captured_unconfirmed' }]);
    expect(facts('Denied CO fifty.')).toMatchObject([
      { category: 'status', value: 'denied' },
      { category: 'denial_code', value: 'CO-50', confidence: 'captured_unconfirmed' },
    ]);
  });
});

describe('what the plan does with a code', () => {
  const ledger = createLedger(BRIEF.claimId);
  const afterVerify = (): PlanState => ({ ...initialPlan(), moves: { greet: 1, verify: 1, probe_prior: 1 } });

  it('asks for the remark code once a denial reason is on record, and the row fills the gate', () => {
    let session = startCall(ledger, { callId: 'call-live', capturedAt: '2026-09-29T14:00:00Z' });
    session = ingestRepTurn(session, turn('This is Smith, badge number 2267.')).session;
    session = ingestRepTurn(session, turn('The claim denied, non-covered.')).session;
    let plan = afterVerify();
    const keys: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = nextMove(plan, BRIEF, session.ledger, 'call-live', []);
      plan = next.state;
      keys.push(next.move.key);
      if (next.move.line) session = noteUsLine(session, next.move.line.text);
      if (next.move.key === 'ask:remark_code') break;
      // The Rep answers each ask briefly so the plan moves on.
      if (next.move.key === 'ask:remit_reason') session = ingestRepTurn(session, turn('The remit says non-covered too.')).session;
    }
    expect(keys).toContain('ask:remark_code');
    session = ingestRepTurn(session, turn('The remark code is N thirty.')).session;
    const gate = computeGate(session.ledger, 'call-live', BRIEF.objectives);
    expect(gate.find((g) => g.key === 'remark_code')).toMatchObject({ state: 'confirmed', value: 'N30' });
  });

  it('reads back a code it cannot verify, and the confirmation is a new row', () => {
    let session = startCall(ledger, { callId: 'call-live', capturedAt: '2026-09-29T14:00:00Z' });
    session = ingestRepTurn(session, turn('This is Smith, badge number 2267.')).session;
    session = ingestRepTurn(session, turn('Denied, CO fifty, reference number 8K2J-991.')).session;
    // Reference confirmed first, as the plan orders it.
    session = noteUsLine(session, 'Let me read that back. eight K two J; nine nine one. Did I get that right?');
    session = ingestRepTurn(session, turn('Yes.')).session;
    let plan: PlanState = { ...initialPlan(), moves: { greet: 1, verify: 1, probe_prior: 1, 'ask:denial_reason': 1, 'ask:remit_reason': 1, 'ask:remark_code': 1 } };
    const next = nextMove(plan, BRIEF, session.ledger, 'call-live', []);
    expect(next.move.key).toBe('readback:CO-50');
    expect(next.move.line?.text).toMatch(/C O; five zero/);
    session = noteUsLine(session, next.move.line!.text);
    session = ingestRepTurn(session, turn("That's right.")).session;
    const rows = session.ledger.statements.filter((s) => s.kind === 'fact' && s.category === 'denial_code');
    expect(rows).toHaveLength(2);
    expect(rows[1].kind === 'fact' && rows[1].confirms).toBe(rows[0].id);
    plan = next.state;
    expect(nextMove(plan, BRIEF, session.ledger, 'call-live', []).move.key).not.toMatch(/^readback/);
  });

  it('a different remark code on a later call is a value conflict, and the recap and sheet carry the code', () => {
    let s1 = startCall(ledger, { callId: 'call-a', capturedAt: '2026-08-01T14:00:00Z' });
    s1 = ingestRepTurn(s1, turn('This is Reese, badge 2210. Denied, remark code N thirty.')).session;
    let s2 = startCall(s1.ledger, { callId: 'call-b', capturedAt: '2026-09-29T14:00:00Z' });
    s2 = ingestRepTurn(s2, turn('This is Reese, badge 2210. Remark code N one thirty.')).session;
    const conflicts = detect(s2.ledger).filter((c) => c.kind === 'value_conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sameBadge).toBe(true);
    expect(closeOutForRep(s2.ledger, 'call-b').text).toMatch(/remark code N one three zero/);
    expect(closeOutForAgent(s2.ledger, 'call-b', conflicts, 0).text).toMatch(/Remark code N one three zero/);
    const sheet = buildClaimUpdate(s2.ledger, 'call-b', conflicts, 0);
    expect(sheet.rows.find((r) => r.field === 'Remark code')).toMatchObject({ value: 'N130', state: 'confirmed' });
  });
});
