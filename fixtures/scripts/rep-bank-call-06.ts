import type { RepBank } from '@/domain/mode-a';

/**
 * The Rep Simulator's lines for the live call (call 06, D. Reese). Keyed by the Witness move that
 * provokes each line. Same wording as fixtures/scripts/claim-A-4471-08.ts, so the golden log holds.
 */
export const REP_BANK_CALL_06: RepBank = {
  greet: { who: 'REP', text: 'Meridian claims, this is Darnell, badge two-two-one-zero.' },
  verify: { who: 'REP', text: 'Okay. That claim denied. Timely filing.', holdBeforeSeconds: 242 },
  'challenge:value_conflict': { who: 'REP', text: "I'm showing timely filing today." },
  probe_prior: { who: 'REP', text: "I don't have a record of a call on August fifth." },
  'challenge:existence_denial': { who: 'REP', text: "I'd have to look into that." },
  'ask:remit_reason': { who: 'REP', text: "There's also a diagnosis issue on it." },
  'ask:specific_code': { who: 'REP', text: "It doesn't specify on my screen." },
  'ask:remark_code': { who: 'REP', text: "I'd have to refer you to the denial letter." },
  'ask:reference_number': { who: 'REP', text: 'Eight-K-two-J, nine-eight-eight.', lowConfidence: true },
  readback: { who: 'REP', text: "That's correct." },
  recap: { who: 'REP', text: "You're welcome. Goodbye." },
};
