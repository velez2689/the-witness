import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { canHangUp, computeGate } from '@/domain/capture-gate';
import { createLedger } from '@/domain/claim-ledger';
import { runModeA, startModeA, type CallEvent } from '@/domain/mode-a';
import { buildHistory } from '@/domain/script-runner';
import { callContext, verifyClaim } from '@/domain/speech';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';

/**
 * A claim nobody has called on yet.
 *
 * The Witness exists to catch a payer contradicting its own record, so every test until now gave
 * it a record to contradict. But the first call on a claim is the commonest call a biller makes,
 * and on that call there is nothing to check against: the job is purely to gather, and claiming
 * to hold prior notes would be a lie told on a recorded line.
 *
 * The plan already fell through its challenge and prior-call steps when the ledger was empty -
 * what it did not do was SOUND any different, so a first call opened exactly like a sixth one.
 */
const BRIEF: CallBrief = {
  claimId: CLAIM.id,
  payer: CLAIM.payer,
  providerName: 'Harbor Orthopedic Billing',
  patientLabel: CLAIM.patient,
  memberId: CLAIM.memberId,
  dateOfService: CLAIM.dateOfService,
  dxCodes: CLAIM.dxCodes,
  billed: CLAIM.billed,
  objectives: DEFAULT_OBJECTIVES,
};

/** A cooperative rep on a fresh claim: no contradictions to find, every question answered. */
const FRESH_REP = {
  greet: { who: 'REP', text: 'Meridian claims, this is Karen, badge five five one two.' },
  verify: { who: 'REP', text: 'That one is showing denied.' },
  'ask:denial_reason': { who: 'REP', text: 'It was denied for timely filing.' },
  'ask:remit_reason': { who: 'REP', text: 'The remit says timely filing as well.' },
  'ask:reference_number': { who: 'REP', text: 'Your reference is eight K two J, four zero one.' },
  readback: { who: 'REP', text: 'That is correct.' },
  recap: { who: 'REP', text: 'That is right.' },
} as const;

const witnessLines = (events: CallEvent[]) => events.flatMap((e) => (e.type === 'witness' ? [e] : []));

const firstCall = () =>
  runModeA(
    startModeA(createLedger(CLAIM.id), BRIEF, { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt }, FRESH_REP),
  );

describe('first call on a claim: gather, do not pretend to remember', () => {
  it('reads the approach from the ledger rather than being told', () => {
    expect(callContext(createLedger(CLAIM.id), LIVE_CALL.id).approach).toBe('first_contact');
    const withHistory = buildHistory(CLAIM.id, CALLS).ledger;
    const ctx = callContext(withHistory, LIVE_CALL.id);
    expect(ctx.approach).toBe('follow_up');
    expect(ctx.priorCallIds.length).toBeGreaterThan(1);
    expect(ctx.lastCallAt).not.toBeNull();
  });

  it('says it is a first call, and never claims to hold notes it does not have', () => {
    const line = witnessLines(firstCall().events).find((e) => e.move.key === 'verify')!;
    expect(line.text).toMatch(/first call/i);
    expect(line.text).not.toMatch(/notes|before|previously|last time/i);
    expect(line.cites).toEqual([]);
  });

  it('a follow-up call says prior calls are on file, and how many', () => {
    const history = buildHistory(CLAIM.id, CALLS);
    const ctx = callContext(history.ledger, LIVE_CALL.id);
    const line = verifyClaim(BRIEF, ctx);
    expect(line.text).toMatch(/times before/);
    expect(line.text).toMatch(/notes from those calls/);
  });

  it('never challenges or probes a prior call when there is no prior call', () => {
    const keys = witnessLines(firstCall().events).map((e) => e.move.key);
    expect(keys.filter((k) => k.startsWith('challenge:'))).toEqual([]);
    expect(keys).not.toContain('probe_prior');
  });

  /** The point of the mode: it still has to come away with the fields the Agent needs. */
  it('still gathers every required field and closes cleanly', () => {
    const s = firstCall();
    const gate = computeGate(s.session.ledger, LIVE_CALL.id, BRIEF.objectives);
    expect(gate.find((g) => g.key === 'reference_number')?.state).toBe('confirmed');
    expect(canHangUp(gate)).toBe(true);
    expect(s.plan.needsAgent).toBeNull();
    expect(s.plan.done).toBe(true);
  });

  it('says goodbye rather than going silent', () => {
    const last = witnessLines(firstCall().events).at(-1)!;
    expect(last.text.trim()).not.toBe('');
    expect(last.text).toMatch(/thank|thanks/i);
  });

  it('the first call becomes the record the NEXT call checks against', () => {
    const after = firstCall().session.ledger;
    expect(callContext(after, 'call-99').approach).toBe('follow_up');
    const reasons = after.statements.filter((x) => x.kind === 'fact' && x.category === 'denial_reason');
    expect(reasons.length).toBeGreaterThan(0);
  });
});
