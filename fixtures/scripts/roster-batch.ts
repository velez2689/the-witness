import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';

/**
 * "While I have you, I have two more."
 *
 * Call 06 is one call on one phone line. After the Delgado claim is worked, the Agent keeps the
 * rep and works two more patients rather than paying the IVR and the hold queue twice more.
 * This is the normal shape of the job, and it is where claim notes get cross-contaminated.
 *
 * The Nazario segment contains the failure this product exists to catch: the rep pulls up the
 * WRONG patient and reads Okonkwo's member ID aloud while the console is on Nazario. Nothing is
 * silently re-routed — the Witness challenges the rep on the line and the Agent decides.
 */

export interface RosterPatient {
  brief: CallBrief;
  patientLabel: string;
  /** The "while I have you" segment for this patient, in order. */
  lines: readonly { who: 'REP' | 'US'; text: string; holdBeforeSeconds?: number }[];
}

const OKONKWO_MEMBER = 'MD55830417';
const NAZARIO_MEMBER = 'MD91662350';

const brief = (over: Partial<CallBrief> & Pick<CallBrief, 'claimId' | 'patientLabel' | 'memberId'>): CallBrief => ({
  payer: 'Meridian Health Plan',
  providerName: 'Harbor Orthopedic Billing',
  dateOfService: '2026-06-02',
  dxCodes: [],
  billed: 0,
  objectives: DEFAULT_OBJECTIVES,
  ...over,
});

export const ROSTER_BATCH: readonly RosterPatient[] = [
  {
    patientLabel: 'J. Okonkwo',
    brief: brief({
      claimId: 'B-2290-15',
      patientLabel: 'J. Okonkwo',
      memberId: OKONKWO_MEMBER,
      dateOfService: '2026-06-02',
      dxCodes: ['S83.241'],
      billed: 1615,
    }),
    lines: [
      { who: 'US', text: 'While I have you, I have two more on the same provider. Next is member M-D-five-five-eight-three-zero-four-one-seven, date of service June second.' },
      { who: 'REP', text: 'One moment.' },
      { who: 'REP', text: 'Okay, that claim denied as well. No prior authorization.', holdBeforeSeconds: 96 },
      { who: 'US', text: 'Can I get a reference number for that one?' },
      { who: 'REP', text: 'Seven-R-four-B-two-six-one.' },
      { who: 'US', text: 'Let me read that back. Seven-R-four-B-two-six-one?' },
      { who: 'REP', text: "That's correct." },
    ],
  },
  {
    patientLabel: 'P. Nazario',
    brief: brief({
      claimId: 'C-8812-02',
      patientLabel: 'P. Nazario',
      memberId: NAZARIO_MEMBER,
      dateOfService: '2026-06-11',
      dxCodes: ['M25.561'],
      billed: 980,
    }),
    lines: [
      { who: 'US', text: 'Last one. Member M-D-nine-one-six-six-two-three-five-zero, date of service June eleventh.' },
      // The rep is still looking at the previous patient. This is the contamination moment.
      { who: 'REP', text: 'Right, I have M-D-five-five-eight-three-zero-four-one-seven up. That one denied for no prior auth.' },
      { who: 'US', text: "That's the previous patient. I'm asking about M-D-nine-one-six-six-two-three-five-zero, June eleventh." },
      { who: 'REP', text: 'My apologies, let me pull that up. Okay, this one is in process.' },
      { who: 'US', text: 'Reference number?' },
      { who: 'REP', text: 'Four-T-nine-C-five-zero-three.' },
      { who: 'US', text: 'Four-T-nine-C-five-zero-three?' },
      { who: 'REP', text: "That's right." },
    ],
  },
];

/** Every patient on call 06, Delgado first. The Delgado brief comes from the main corpus. */
export const ROSTER_HOLD_SECONDS = ROSTER_BATCH.reduce(
  (n, p) => n + p.lines.reduce((m, l) => m + (l.holdBeforeSeconds ?? 0), 0),
  0,
);
