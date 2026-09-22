import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import {
  activeEntry,
  canEndCall,
  ingestToActive,
  noteUsLineOnActive,
  callIdentity,
  outstanding,
  releaseQuarantineTo,
  rosterGates,
  startRoster,
  switchTo,
  type CallRoster,
  type QuarantinedTurn,
  type WrongClaimWarning,
} from '@/domain/call-roster';
import { createLedger } from '@/domain/claim-ledger';
import type { FactStatement } from '@/domain/statement';
import { ROSTER_BATCH } from '@fixtures/scripts/roster-batch';

/**
 * The demo batch, driven through the real domain. This is the test that proves the fixture
 * actually exercises the wrong-claim guard rather than merely describing it in a comment.
 */

const LEAD: CallBrief = {
  claimId: 'A-4471-08',
  payer: 'Meridian Health Plan',
  providerName: 'Harbor Orthopedic Billing',
  patientLabel: 'R. Delgado',
  memberId: 'MD77140228',
  dateOfService: '2026-05-18',
  dxCodes: ['M54.51'],
  billed: 2840,
  objectives: DEFAULT_OBJECTIVES,
};

const CALL = { callId: 'call-06', capturedAt: '2026-08-26T17:31:00Z' };

function freshRoster(): CallRoster {
  return startRoster(
    [
      { brief: LEAD, patientLabel: 'R. Delgado', ledger: createLedger(LEAD.claimId) },
      ...ROSTER_BATCH.map((p) => ({ brief: p.brief, patientLabel: p.patientLabel, ledger: createLedger(p.brief.claimId) })),
    ],
    CALL,
  );
}

/** Play the whole call: the rep identifies, then every batch segment in order. */
function playBatch(): { roster: CallRoster; warnings: WrongClaimWarning[]; held: QuarantinedTurn[] } {
  let r = freshRoster();
  const warnings: WrongClaimWarning[] = [];
  // The lead claim: the rep identifies and gives a reference number (call 06, abbreviated).
  r = ingestToActive(r, { text: 'Meridian claims, this is Darnell, badge two-two-one-zero.', startMs: 0, endMs: 2400 }).roster;
  r = noteUsLineOnActive(r, 'Reference number for today?');
  r = ingestToActive(r, { text: 'Eight-K-two-J, nine-eight-eight.', startMs: 3000, endMs: 5400 }).roster;

  let at = 6000;
  for (const patient of ROSTER_BATCH) {
    r = switchTo(r, patient.brief.claimId);
    for (const line of patient.lines) {
      at += (line.holdBeforeSeconds ?? 0) * 1000;
      if (line.who === 'US') {
        r = noteUsLineOnActive(r, line.text);
      } else {
        const result = ingestToActive(r, { text: line.text, startMs: at, endMs: at + 2400 });
        r = result.roster;
        if (result.wrongClaim) warnings.push(result.wrongClaim);
      }
      at += 2400;
    }
  }
  return { roster: r, warnings, held: [...r.quarantine] };
}

const factsOf = (r: CallRoster, claimId: string) =>
  r.entries
    .find((e) => e.brief.claimId === claimId)!
    .session.ledger.statements.filter((s): s is FactStatement => s.kind === 'fact');

describe('the demo batch: one call, three patients', () => {
  it('has three distinct patients with three distinct member IDs', () => {
    const ids = [LEAD.memberId, ...ROSTER_BATCH.map((p) => p.brief.memberId)];
    expect(new Set(ids).size).toBe(3);
  });

  it('fires the wrong-claim guard exactly once, when the rep reads Okonkwo while on Nazario', () => {
    const { warnings } = playBatch();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      spokenClaimId: 'B-2290-15',
      expectedClaimId: 'C-8812-02',
      spokenPatient: 'J. Okonkwo',
    });
  });

  it('never lets Okonkwo’s denial reason reach Nazario’s ledger', () => {
    const { roster } = playBatch();
    const nazario = factsOf(roster, 'C-8812-02');
    // The rep said "no prior auth" while holding up the wrong patient. It must not be filed here.
    expect(nazario.filter((s) => s.category === 'denial_reason')).toHaveLength(0);
    expect(nazario.some((s) => s.category === 'status' && s.value === 'in process')).toBe(true);
  });

  it('files the member ID the rep misread as nobody’s reference number', () => {
    const { roster } = playBatch();
    for (const claimId of ['A-4471-08', 'B-2290-15', 'C-8812-02']) {
      const refs = factsOf(roster, claimId).filter((s) => s.category === 'reference_number');
      expect(refs.map((s) => s.value)).not.toContain('MD55-830417');
      expect(refs.every((s) => !s.value.replace(/-/g, '').startsWith('MD'))).toBe(true);
    }
  });

  it('captures each patient’s own reference number against their own claim', () => {
    const { roster } = playBatch();
    const refOf = (claimId: string) =>
      factsOf(roster, claimId).filter((s) => s.category === 'reference_number').map((s) => s.value);
    expect(refOf('A-4471-08')).toContain('8K2J-988');
    expect(refOf('B-2290-15')).toContain('7R4B-261');
    expect(refOf('C-8812-02')).toContain('4T9C-503');
    // and nobody else's
    expect(refOf('B-2290-15')).not.toContain('8K2J-988');
    expect(refOf('C-8812-02')).not.toContain('7R4B-261');
  });

  it('identifies the rep exactly once, in the ledger where it was actually captured', () => {
    const { roster } = playBatch();
    const rows = roster.entries.flatMap((e) =>
      e.session.ledger.statements.filter((s) => s.kind === 'fact' && s.category === 'rep_identity'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].claimId).toBe('A-4471-08');
    expect(callIdentity(roster)?.id).toBe(rows[0].id);
  });

  it('clears every patient’s gate from that one identity row', () => {
    const { roster } = playBatch();
    expect(outstanding(roster)).toHaveLength(0);
    for (const g of rosterGates(roster)) {
      expect(g.items.find((i) => i.key === 'rep_badge')!.value).toBe('2210');
    }
  });

  it('holds the call open until the Agent rules on the held turn, then lets it close', () => {
    const { roster, held } = playBatch();
    // Every gate is clear, but the wrong-chart turn is still waiting on a decision.
    expect(outstanding(roster)).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(canEndCall(roster)).toBe(false);

    // The Agent files it to the patient the rep was actually reading.
    const after = releaseQuarantineTo(roster, held[0].id, held[0].warning.spokenClaimId).roster;
    expect(after.quarantine).toHaveLength(0);
    expect(canEndCall(after)).toBe(true);
  });

  it('loses nothing to the quarantine: the held words stay available verbatim', () => {
    const { held } = playBatch();
    expect(held[0].turn.text).toContain('denied for no prior auth');
    expect(held[0].contains.map((c) => c.value)).toContain('no prior authorization');
  });

  it('blocks hang-up while a later patient has not been worked yet', () => {
    let r = freshRoster();
    r = ingestToActive(r, { text: 'Meridian claims, this is Darnell, badge two-two-one-zero.', startMs: 0, endMs: 2400 }).roster;
    r = noteUsLineOnActive(r, 'Reference number for today?');
    r = ingestToActive(r, { text: 'Eight-K-two-J, nine-eight-eight.', startMs: 3000, endMs: 5400 }).roster;
    expect(canEndCall(r)).toBe(false);
    expect(outstanding(r).map((g) => g.patientLabel)).toEqual(['J. Okonkwo', 'P. Nazario']);
  });

  it('keeps every statement id unique across the whole call', () => {
    const { roster } = playBatch();
    const ids = roster.entries.flatMap((e) => e.session.ledger.statements.map((s) => s.id));
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the active patient where the Agent put it, whatever the rep says', () => {
    let r = freshRoster();
    r = switchTo(r, 'C-8812-02');
    const before = activeEntry(r).brief.claimId;
    r = ingestToActive(r, {
      text: 'Right, I have M-D-five-five-eight-three-zero-four-one-seven up.',
      startMs: 0,
      endMs: 2400,
    }).roster;
    expect(activeEntry(r).brief.claimId).toBe(before);
  });

  it('reports a per-patient gate for the band to render', () => {
    const gates = rosterGates(freshRoster());
    expect(gates.map((g) => g.patientLabel)).toEqual(['R. Delgado', 'J. Okonkwo', 'P. Nazario']);
    expect(gates.filter((g) => g.active)).toHaveLength(1);
  });
});
