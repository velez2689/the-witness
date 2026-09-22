import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import {
  activeEntry,
  canEndCall,
  checkWrongClaim,
  ingestToActive,
  noteUsLineOnActive,
  outstanding,
  rosterGates,
  startRoster,
  switchTo,
} from '@/domain/call-roster';
import { createLedger } from '@/domain/claim-ledger';
import type { FactStatement } from '@/domain/statement';

/**
 * One call, three patients — the batch a biller actually makes. The thing being proven here
 * is that nothing said about one patient can ever land in another patient's ledger.
 */

function brief(claimId: string, memberId: string): CallBrief {
  return {
    claimId,
    payer: 'Meridian Health Plan',
    providerName: 'Harbor Orthopedic Billing',
    patientLabel: claimId,
    memberId,
    dateOfService: '2026-05-18',
    dxCodes: ['M54.51'],
    billed: 2840,
    objectives: DEFAULT_OBJECTIVES,
  };
}

const PATIENTS = [
  { brief: brief('A-4471-08', 'MD77140228'), patientLabel: 'R. Delgado', ledger: createLedger('A-4471-08') },
  { brief: brief('B-2290-15', 'MD55830417'), patientLabel: 'J. Okonkwo', ledger: createLedger('B-2290-15') },
  { brief: brief('C-8812-02', 'MD91662350'), patientLabel: 'P. Nazario', ledger: createLedger('C-8812-02') },
];

const start = () => startRoster(PATIENTS, { callId: 'call-07', capturedAt: '2026-08-26T17:31:00Z' });
const turn = (text: string, startMs = 0) => ({ text, startMs, endMs: startMs + 2000 });

const factsOf = (r: ReturnType<typeof start>, i: number) =>
  r.entries[i].session.ledger.statements.filter((s): s is FactStatement => s.kind === 'fact');

describe('one call, several patients', () => {
  it('starts on the first patient and keeps a ledger per claim', () => {
    const r = start();
    expect(activeEntry(r).brief.claimId).toBe('A-4471-08');
    expect(r.entries).toHaveLength(3);
    expect(r.entries.map((e) => e.session.ledger.claimId)).toEqual(['A-4471-08', 'B-2290-15', 'C-8812-02']);
  });

  it('files every statement against the ACTIVE patient only', () => {
    let r = start();
    r = ingestToActive(r, turn('This is Darnell, badge two-two-one-zero.')).roster;
    r = ingestToActive(r, turn('That claim denied. Timely filing.')).roster;

    expect(factsOf(r, 0).some((s) => s.category === 'denial_reason' && s.value === 'timely filing')).toBe(true);
    expect(r.entries[1].session.ledger.statements).toHaveLength(0);
    expect(r.entries[2].session.ledger.statements).toHaveLength(0);
  });

  it('routes the second patient to the second ledger after an explicit switch', () => {
    let r = start();
    r = ingestToActive(r, turn('That claim denied. Timely filing.')).roster;
    r = switchTo(r, 'B-2290-15');
    r = ingestToActive(r, turn('That one denied for no prior authorization.')).roster;

    expect(factsOf(r, 0).map((s) => s.value)).toContain('timely filing');
    expect(factsOf(r, 0).map((s) => s.value)).not.toContain('no prior authorization');
    expect(factsOf(r, 1).map((s) => s.value)).toContain('no prior authorization');
    expect(factsOf(r, 1).map((s) => s.value)).not.toContain('timely filing');
  });

  it('carries the rep identity across the switch — it is the same person on the line', () => {
    let r = start();
    r = ingestToActive(r, turn('This is Darnell, badge two-two-one-zero.')).roster;
    r = switchTo(r, 'B-2290-15');
    expect(activeEntry(r).session.identity).toEqual({ first: 'Darnell', badge: '2210' });
  });

  it('keeps statement ids unique across the claims sharing one call', () => {
    let r = start();
    r = ingestToActive(r, turn('This is Darnell, badge two-two-one-zero.')).roster;
    r = ingestToActive(r, turn('That claim denied. Timely filing.')).roster;
    r = switchTo(r, 'B-2290-15');
    r = ingestToActive(r, turn('That one denied for no prior authorization.')).roster;
    r = ingestToActive(r, turn('Reference eight-K-two-J-four-one-seven.')).roster;

    const ids = r.entries.flatMap((e) => e.session.ledger.statements.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the wrong-claim guard', () => {
  it('warns when the rep reads another patient on the call, and files NOTHING to them', () => {
    let r = start();
    const result = ingestToActive(r, turn('Let me pull up M-D-five-five-eight-three-zero-four-one-seven.'));
    r = result.roster;

    expect(result.wrongClaim).toMatchObject({
      spokenClaimId: 'B-2290-15',
      expectedClaimId: 'A-4471-08',
      spokenPatient: 'J. Okonkwo',
    });
    // The warning is a challenge to the operator. Nothing was re-routed.
    expect(r.entries[1].session.ledger.statements).toHaveLength(0);
  });

  it('quarantines the whole turn — the ACTIVE patient gets nothing from it either', () => {
    let r = start();
    const result = ingestToActive(
      r,
      turn('I have M-D-five-five-eight-three-zero-four-one-seven up. That one denied for no prior auth.'),
    );
    r = result.roster;

    // The rep is reading the wrong chart, so "denied for no prior auth" is about the wrong patient.
    // Filing it to Delgado would record something false about a real patient.
    expect(result.added).toHaveLength(0);
    expect(r.entries.flatMap((e) => e.session.ledger.statements)).toHaveLength(0);
  });

  it('captures the answer normally once the rep re-states it about the right patient', () => {
    let r = start();
    r = ingestToActive(r, turn('I have M-D-five-five-eight-three-zero-four-one-seven up. Denied, no prior auth.')).roster;
    r = ingestToActive(r, turn('My apologies. That claim denied for timely filing.', 4000)).roster;

    const facts = factsOf(r, 0);
    expect(facts.map((s) => s.value)).toContain('timely filing');
    expect(facts.map((s) => s.value)).not.toContain('no prior authorization');
  });

  it('stays quiet when the rep reads the patient who is actually active', () => {
    const r = start();
    expect(checkWrongClaim(r, turn('That is M-D-seven-seven-one-four-zero-two-two-eight.'))).toBeNull();
  });

  it('never files a member ID as a reference number', () => {
    let r = start();
    r = ingestToActive(r, turn('The member is M-D-seven-seven-one-four-zero-two-two-eight.')).roster;
    const refs = factsOf(r, 0).filter((s) => s.category === 'reference_number');
    expect(refs).toHaveLength(0);
  });

  it('still captures a genuine reference number on the same call', () => {
    let r = start();
    r = noteUsLineOnActive(r, 'Can I get a reference number?');
    r = ingestToActive(r, turn('Eight-K-two-J-nine-eight-eight.')).roster;
    expect(factsOf(r, 0).filter((s) => s.category === 'reference_number').map((s) => s.value)).toEqual(['8K2J-988']);
  });
});

describe('the gate runs per patient, and the call cannot close while one is short', () => {
  it('reports a gate for every patient on the call', () => {
    const gates = rosterGates(start());
    expect(gates.map((g) => g.claimId)).toEqual(['A-4471-08', 'B-2290-15', 'C-8812-02']);
    expect(gates.filter((g) => g.active)).toHaveLength(1);
  });

  it('will not end the call while any patient is missing a required field', () => {
    let r = start();
    r = ingestToActive(r, turn('This is Darnell, badge two-two-one-zero.')).roster;
    r = noteUsLineOnActive(r, 'Reference number?');
    r = ingestToActive(r, turn('Eight-K-two-J-nine-eight-eight.')).roster;

    expect(canEndCall(r)).toBe(false);
    const short = outstanding(r);
    expect(short.map((g) => g.claimId)).toEqual(['B-2290-15', 'C-8812-02']);
  });

  it('names exactly which patient is short, so the warning is actionable', () => {
    const short = outstanding(start());
    expect(short).toHaveLength(3);
    expect(short[0].items.filter((i) => i.required && i.state === 'missing').map((i) => i.key)).toEqual([
      'rep_name',
      'rep_badge',
      'reference_number',
    ]);
  });
});
