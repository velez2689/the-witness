import type { ScriptCall } from '@/domain/script';

/**
 * Structured form of fixtures/scripts/claim-A-4471-08.md — the demo corpus.
 * Every name, ID, reference number and payer is invented. No PHI. No CPT descriptors.
 * Text is what a finalized transcript of each scripted line would read as.
 *
 * `who` is the speaker on the line: REP (payer) or US (the Agent, or the Witness in Mode A).
 * Hold durations are synthetic and sum to the 1 h 41 m claim header (6060 s).
 */

export const CLAIM = {
  id: 'A-4471-08',
  patient: 'R. Delgado',
  payer: 'Meridian Health Plan',
  memberId: 'MD77140228',
  dateOfService: '2026-05-18',
  billed: 2840,
  dxCodes: ['M54.51', 'G89.29', 'Z98.890'],
} as const;

export const CALLS: ScriptCall[] = [
  {
    id: 'call-01', number: 1, startedAt: '2026-06-03T13:14:00Z', durationSeconds: 1450, holdSeconds: 1330,
    repFirstName: 'Michelle', repSurname: 'Alvarez', repBadge: '4471', referenceNumber: '8K2J-114',
    lines: [
      { who: 'REP', text: 'Thanks for holding, this is Michelle, badge four-four-seven-one. Can I get the member ID?' },
      { who: 'US', text: 'M as in Mary, D, seven-seven-one-four-zero-two-two-eight.' },
      { who: 'REP', text: 'And date of service?' },
      { who: 'US', text: "May eighteenth, twenty twenty-six. Claim's been sitting a while, I'm just checking status." },
      { who: 'REP', text: "Okay. I'm showing that one received on May twenty-sixth. It's in process right now." },
      { who: 'US', text: 'Any idea how long?' },
      { who: 'REP', text: "It's in process. Allow thirty days from receipt and then call back if you haven't seen anything." },
      { who: 'US', text: 'Can I get a reference number?' },
      { who: 'REP', text: 'Sure. Eight-K-two-J-one-one-four.' },
      { who: 'US', text: 'Eight-K-two-J-one-one-four. Thank you.' },
    ],
  },
  {
    id: 'call-02', number: 2, startedAt: '2026-07-08T15:02:00Z', durationSeconds: 1290, holdSeconds: 1180,
    repFirstName: 'Darnell', repSurname: 'Reese', repBadge: '2210', referenceNumber: '8K2J-338',
    lines: [
      { who: 'REP', text: 'This is Darnell, badge two-two-one-zero. Member ID?' },
      { who: 'US', text: 'M-D-seven-seven-one-four-zero-two-two-eight, date of service May eighteenth.' },
      { who: 'REP', text: 'One moment. Okay. That claim was denied.' },
      { who: 'US', text: 'Denied for what?' },
      { who: 'REP', text: 'No prior authorization on file.' },
      { who: 'US', text: "There's an auth on file, I have the number here." },
      { who: 'REP', text: "I'm only seeing what's in the system. It denied for no prior auth." },
      { who: 'US', text: 'Reference number?' },
      { who: 'REP', text: 'Eight-K-two-J-three-three-eight.' },
      { who: 'US', text: 'Eight-K-two-J-three-three-eight. Thank you.' },
    ],
  },
  {
    id: 'call-03', number: 3, startedAt: '2026-07-22T18:37:00Z', durationSeconds: 1504, holdSeconds: 680,
    repFirstName: null, repSurname: null, repBadge: null, referenceNumber: null,
    lines: [
      { who: 'REP', text: 'Claims department.' },
      { who: 'US', text: 'Hi, can I get your name and badge number?' },
      { who: 'REP', text: 'How can I help you today?' },
      { who: 'US', text: 'Member ID M-D-seven-seven-one-four-zero-two-two-eight, date of service May eighteenth.' },
      { who: 'REP', text: 'Hold please.' },
      { who: 'REP', text: "Okay, that one's showing denied.", holdBeforeSeconds: 680 },
      { who: 'US', text: 'I was told no prior auth on the eighth. Is that still the reason?' },
      { who: 'REP', text: "No, it's denying on a diagnosis code." },
      { who: 'US', text: 'Which one?' },
      { who: 'REP', text: "It just says the diagnosis isn't supported." },
      { who: 'US', text: 'There are three on the claim. Which one is the problem?' },
      { who: 'REP', text: "I don't have that level of detail on my end." },
      { who: 'US', text: 'Is it the primary?' },
      { who: 'REP', text: "I'd have to refer you to the denial letter." },
      { who: 'US', text: 'Can I get a reference number for this call?' },
      { who: 'REP', text: 'You should have gotten a letter.' },
    ],
  },
  {
    id: 'call-04', number: 4, startedAt: '2026-08-05T14:19:00Z', durationSeconds: 1590, holdSeconds: 1465,
    repFirstName: 'Tunde', repSurname: 'Okafor', repBadge: '5182', referenceNumber: '8K2J-702',
    lines: [
      { who: 'REP', text: 'Thank you for calling Meridian, this is Tunde, badge five-one-eight-two.' },
      { who: 'US', text: "M-D-seven-seven-one-four-zero-two-two-eight, date of service May eighteenth. I've had two different denial reasons on this one." },
      { who: 'REP', text: 'Let me look. Okay, we show it was reprocessed on July thirtieth.' },
      { who: 'US', text: 'Reprocessed to pay?' },
      { who: 'REP', text: "It shows reprocessed. I'd give it another fourteen to twenty-one days for the remit." },
      { who: 'US', text: 'Reference number please.' },
      { who: 'REP', text: 'Eight-K-two-J-seven-zero-two.' },
      { who: 'US', text: 'Eight-K-two-J-seven-zero-two. Thanks.' },
    ],
  },
  {
    id: 'call-05', number: 5, startedAt: '2026-08-14T19:48:00Z', durationSeconds: 1290, holdSeconds: 1163,
    repFirstName: 'Sandra', repSurname: 'Whitfield', repBadge: '3390', referenceNumber: '8K2J-915',
    lines: [
      { who: 'REP', text: 'This is Sandra, badge three-three-nine-zero.' },
      { who: 'US', text: 'M-D-seven-seven-one-four-zero-two-two-eight, May eighteenth date of service. I was told on the fifth it was reprocessed.' },
      { who: 'REP', text: "Hmm. I'm not seeing a reprocess. I'm showing a denial." },
      { who: 'US', text: 'For no prior auth?' },
      { who: 'REP', text: 'No, this was denied for timely filing.' },
      { who: 'US', text: 'Timely filing? It was received May twenty-sixth, eight days after service.' },
      { who: 'REP', text: "I can only tell you what's in the system." },
      { who: 'US', text: 'Reference number.' },
      { who: 'REP', text: 'Eight-K-two-J-nine-one-five.' },
      { who: 'US', text: 'Eight-K-two-J-nine-one-five. Thank you.' },
    ],
  },
];

/** Call 06 — Aug 26. THE LIVE CALL. Same rep as call 02, 49 days later. */
export const LIVE_CALL: ScriptCall = {
  id: 'call-06', number: 6, startedAt: '2026-08-26T17:31:00Z', durationSeconds: 620, holdSeconds: 242,
  repFirstName: 'Darnell', repSurname: null, repBadge: '2210', referenceNumber: '8K2J-988',
  lines: [
    { who: 'REP', text: 'Meridian claims, this is Darnell, badge two-two-one-zero.' },
    { who: 'US', text: 'Thank you. Member M-D-seven-seven-one-four-zero-two-two-eight, date of service May eighteenth.' },
    { who: 'REP', text: 'Okay. That claim denied. Timely filing.', holdBeforeSeconds: 242 },
    { who: 'US', text: 'Darnell, on July eighth you told me this was denied for no prior authorization. Which is it?' },
    { who: 'REP', text: "I'm showing timely filing today." },
    { who: 'US', text: 'On August fifth Tunde Okafor told me it was reprocessed on July thirtieth. Reference eight-K-two-J-seven-zero-two.' },
    { who: 'REP', text: "I don't have a record of a call on August fifth." },
    { who: 'US', text: 'I have your reference number for it, eight-K-two-J-seven-zero-two.' },
    { who: 'REP', text: "I'd have to look into that." },
    { who: 'US', text: "What's the actual denial reason on the remit?" },
    { who: 'REP', text: "There's also a diagnosis issue on it." },
    { who: 'US', text: 'Which diagnosis code?' },
    { who: 'REP', text: "It doesn't specify on my screen." },
    { who: 'US', text: 'Can you read me the remark code exactly as it appears?' },
    { who: 'REP', text: "I'd have to refer you to the denial letter." },
    { who: 'US', text: 'Reference number for today?' },
    { who: 'REP', text: 'Eight-K-two-J, nine-eight-eight.', lowConfidence: true },
    { who: 'US', text: 'Let me read that back. Eight-K-two-J-nine-eight-eight?' },
    { who: 'REP', text: "That's correct." },
  ],
};

export const TOTAL_HOLD_SECONDS = [...CALLS, LIVE_CALL].reduce((n, c) => n + c.holdSeconds, 0);
