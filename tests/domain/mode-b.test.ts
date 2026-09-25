import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { runModeB, startModeB } from '@/domain/mode-b';
import { buildHistory } from '@/domain/script-runner';
import { checkSpeech } from '@/domain/speech';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';

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
const final = runModeB(startModeB(history.ledger, BRIEF, LIVE_CALL));
const whispers = final.events.flatMap((e) => (e.type === 'whisper' ? [e] : []));

describe('Mode B: the Agent speaks, the Witness whispers', () => {
  it('whispers on the value conflict without pronouns and names the same badge', () => {
    const w = whispers.find((x) => x.reason === 'value_conflict')!;
    expect(w.text).toContain('no prior authorization');
    expect(w.text).toContain('Same badge');
    expect(w.text).not.toMatch(/\b(he|him|his|she|her)\b/i);
  });

  it('whispers the existence denial with the payer-issued reference', () => {
    const w = whispers.find((x) => x.reason === 'existence_denial')!;
    expect(w.text).toContain('eight K two J; seven zero two');
  });

  it('turns a low-confidence reference number into a spoken read-back prompt, never a guess', () => {
    const w = whispers.find((x) => x.reason === 'readback')!;
    expect(w.text).toContain('eight K two J; nine eight eight');
    expect(w.text).toMatch(/repeat/);
  });

  it('never speaks on the line: every Witness output is a whisper or the Close-Out', () => {
    expect(final.events.every((e) => ['agent', 'rep', 'whisper', 'closeout'].includes(e.type))).toBe(true);
  });

  it('ends with a Close-Out rendered from rows that passes the speech self-check', () => {
    const out = final.events.find((e) => e.type === 'closeout')!;
    expect(out.type === 'closeout' && out.text).toContain('Call closed.');
    if (out.type === 'closeout') {
      expect(checkSpeech(out.text, final.session.ledger, BRIEF).unknown).toEqual([]);
    }
    expect(final.holdSeconds).toBe(242);
  });

  it('every whisper passes the speech self-check', () => {
    for (const w of whispers) expect(checkSpeech(w.text, final.session.ledger, BRIEF).unknown, w.text).toEqual([]);
  });
});
