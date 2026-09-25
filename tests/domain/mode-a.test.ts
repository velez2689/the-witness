import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { canHangUp, computeGate } from '@/domain/capture-gate';
import { MAX_CHALLENGES } from '@/domain/call-plan';
import { runModeA, startModeA, type CallEvent } from '@/domain/mode-a';
import { buildHistory } from '@/domain/script-runner';
import { checkSpeech, closeOutForAgent } from '@/domain/speech';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';
import { REP_BANK_CALL_06 } from '@fixtures/scripts/rep-bank-call-06';

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

const history = buildHistory(CLAIM.id, CALLS);
const start = () =>
  startModeA(history.ledger, BRIEF, { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt }, REP_BANK_CALL_06);
const final = runModeA(start());

const witnessLines = (events: CallEvent[]) =>
  events.flatMap((e) => (e.type === 'witness' ? [e] : []));

describe('Mode A: the Witness conducts call 06 against the Rep Simulator', () => {
  it('opens with a verbatim AI + recording disclosure and asks for name and badge', () => {
    const [greet] = witnessLines(final.events);
    expect(greet.move.kind).toBe('greet');
    expect(greet.text).toMatch(/AI assistant/);
    expect(greet.text).toMatch(/recorded/);
    expect(greet.text).toMatch(/name and badge/);
  });

  it('challenges the same-badge value conflict on the recorded line, quoting the prior call', () => {
    const c = witnessLines(final.events).find((e) => e.move.key === 'challenge:value_conflict')!;
    expect(c.text).toContain('July eighth');
    expect(c.text).toContain('D Reese');
    expect(c.text).toContain('two two one zero');
    expect(c.text).toContain('eight K two J, three three eight');
    expect(c.text).toContain('no prior authorization');
    expect(c.text).toContain('timely filing');
    expect(c.text).toContain('same badge'); // the callout survives rewording; the fact is what matters
    expect(c.cites.length).toBeGreaterThanOrEqual(3);
  });

  it('probes the prior call and then challenges the existence denial with the payer’s own reference', () => {
    const keys = witnessLines(final.events).map((e) => e.move.key);
    expect(keys.indexOf('probe_prior')).toBeGreaterThan(keys.indexOf('challenge:value_conflict'));
    expect(keys.indexOf('challenge:existence_denial')).toBeGreaterThan(keys.indexOf('probe_prior'));
    const ex = witnessLines(final.events).find((e) => e.move.key === 'challenge:existence_denial')!;
    expect(ex.text).toContain('August fifth');
    expect(ex.text).toContain('eight K two J, seven zero two');
  });

  it('never challenges more than the cap', () => {
    const n = witnessLines(final.events).filter((e) => e.move.kind === 'challenge').length;
    expect(n).toBeLessThanOrEqual(MAX_CHALLENGES);
  });

  it('follows the refusal chain: diagnosis code, then remark code, then records both as refusals', () => {
    const keys = witnessLines(final.events).map((e) => e.move.key);
    expect(keys).toContain('ask:specific_code');
    expect(keys.indexOf('ask:remark_code')).toBeGreaterThan(keys.indexOf('ask:specific_code'));
    const refusals = final.session.ledger.statements.filter((s) => s.callId === 'call-06' && s.kind === 'refusal');
    expect(refusals.map((r) => r.category)).toEqual(['diagnosis_code', 'remark_code']);
  });

  it('reads the reference number back and only closes after the Rep confirms it', () => {
    const keys = witnessLines(final.events).map((e) => e.move.key);
    expect(keys.indexOf('readback')).toBeGreaterThan(keys.indexOf('ask:reference_number'));
    expect(keys.indexOf('recap')).toBeGreaterThan(keys.indexOf('readback'));
    const gate = computeGate(final.session.ledger, 'call-06', BRIEF.objectives);
    expect(gate.find((g) => g.key === 'reference_number')?.state).toBe('confirmed');
    expect(canHangUp(gate)).toBe(true);
    expect(final.plan.done).toBe(true);
    expect(final.plan.needsAgent).toBeNull();
  });

  it('every line the Witness speaks passes the speech self-check against the record', () => {
    for (const e of witnessLines(final.events)) {
      const check = checkSpeech(e.text, final.session.ledger, BRIEF);
      expect(check.unknown, e.text).toEqual([]);
    }
  });

  it('the self-check catches a drifted, fabricated reference number', () => {
    const drifted = 'Let me read that back: eight K two J, nine one five. Is that correct?';
    const bad = 'The reference is eight K two J, four four four.';
    expect(checkSpeech(drifted, final.session.ledger, BRIEF).ok).toBe(true); // 915 is a real prior reference
    expect(checkSpeech(bad, final.session.ledger, BRIEF)).toEqual({ ok: false, unknown: ['8K2J-444'] });
  });

  /*
   * Identifiers are now spoken in groups so they do not come out as one flat run, which means
   * transcript.agent can return them already split. Flagging a fragment would report the Witness
   * fabricating "8K2J" - the opposite of the truth, and the fastest way to teach an operator to
   * ignore the one alarm that must never be ignored.
   */
  it('does not cry fabrication when the transcript splits an identifier into its groups', () => {
    const split = 'Let me read that back: 8K2J 988. Is that correct?';
    expect(checkSpeech(split, final.session.ledger, BRIEF)).toEqual({ ok: true, unknown: [] });
  });

  it('still catches a fabrication when only the first half is real', () => {
    const half = 'Your reference is 8K2J 777.';
    expect(checkSpeech(half, final.session.ledger, BRIEF).ok).toBe(false);
  });

  it('holds on-record hold time for the header and renders the Close-Out from rows only', () => {
    expect(final.holdSeconds).toBe(242);
    const out = closeOutForAgent(final.session.ledger, 'call-06', detectCall06(), final.holdSeconds);
    expect(out.text).toContain('D Reese');
    expect(out.text).toContain('eight K two J, nine eight eight');
    expect(out.text).toContain('Denial reason today: timely filing.');
    expect(out.text).toContain('Conflicts with the same representative');
    expect(out.text).toContain('diagnosis code: not provided, refused.');
    expect(out.text).toContain('No record acknowledged of the August fifth call');
    expect(out.text).toContain('4 minutes 2 seconds on hold');
  });

  it('is deterministic: two runs produce the same call', () => {
    const again = runModeA(start());
    expect(again.events.map((e) => (e.type === 'witness' ? e.text : e.line.text))).toEqual(
      final.events.map((e) => (e.type === 'witness' ? e.text : e.line.text)),
    );
  });

  it('without a reference number the plan asks twice, then hands the call to the Agent instead of closing', () => {
    const noRef = { ...REP_BANK_CALL_06, 'ask:reference_number': { who: 'REP', text: 'Let me transfer you.' } } as const;
    const s = runModeA(startModeA(history.ledger, BRIEF, { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt }, noRef));
    expect(s.plan.needsAgent).toMatch(/reference number/i);
    expect(witnessLines(s.events).some((e) => e.move.kind === 'close')).toBe(false);
  });
});

import { detect } from '@/domain/engine';
function detectCall06() {
  return detect(final.session.ledger).filter((c) => c.statementIds[1].startsWith('stmt-call-06-'));
}
