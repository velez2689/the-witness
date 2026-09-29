import type { ClaimId } from './statement';

/** What the Agent needs answered on a call. Each becomes a step of the call plan and part of the exit gate. */
export type ObjectiveKey =
  | 'claim_status'
  | 'denial_reason'
  | 'remit_reason'
  | 'specific_code'
  | 'remark_code'
  | 'appeal_deadline'
  | 'auth_number';

export interface Objective {
  key: ObjectiveKey;
  label: string;
  /** Deterministic question, spoken by the Witness (Mode A) or whispered to the Agent (Mode B). */
  ask: string;
  /** The same question the second time, in other words: a Rep who heard it once is never read the same line twice. */
  askAgain: string;
}

export const OBJECTIVES: Record<ObjectiveKey, Objective> = {
  claim_status: {
    key: 'claim_status',
    label: 'Claim status',
    ask: 'What is the current status of the claim?',
    askAgain: 'Sorry, I want to be sure I have it. Is the claim paid, denied, pending, or in process right now?',
  },
  denial_reason: {
    key: 'denial_reason',
    label: 'Denial reason',
    ask: 'What is the denial reason on the claim?',
    askAgain: 'Just so I have it exactly, what does the remit give as the denial reason?',
  },
  remit_reason: {
    key: 'remit_reason',
    label: 'Reason on the remit',
    ask: 'What is the denial reason exactly as it appears on the remit?',
    askAgain: 'Could you read me the denial line word for word from the remit?',
  },
  specific_code: {
    key: 'specific_code',
    label: 'Specific code',
    ask: 'Which code is affected, exactly?',
    askAgain: 'Which code is it, as it appears on your screen?',
  },
  remark_code: {
    key: 'remark_code',
    label: 'Remark code',
    ask: 'Can you read me the remark code exactly as it appears?',
    askAgain: 'Is there a remark code on the line, and what does it say?',
  },
  appeal_deadline: {
    key: 'appeal_deadline',
    label: 'Appeal deadline',
    ask: 'What is the deadline to appeal, and where should the appeal be sent?',
    askAgain: 'How many days do we have to appeal, and what address or fax does it go to?',
  },
  auth_number: {
    key: 'auth_number',
    label: 'Authorization number',
    ask: 'Is there an authorization number on file for this claim?',
    askAgain: 'Do you see any authorization on file for this date of service?',
  },
};

/** The Agent's intake for one call. The Witness may only share facts that appear here. */
export interface CallBrief {
  claimId: ClaimId;
  payer: string;
  /** Billing office the Witness says it is calling for. */
  providerName: string;
  patientLabel: string;
  memberId: string;
  dateOfService: string;
  dxCodes: readonly string[];
  billed: number;
  objectives: readonly ObjectiveKey[];
}

export const DEFAULT_OBJECTIVES: readonly ObjectiveKey[] = [
  'denial_reason',
  'remit_reason',
  'specific_code',
  'remark_code',
];

/** Every value the Witness is allowed to say about this claim, for the speech self-check. */
export function briefFacts(brief: CallBrief): string[] {
  return [brief.claimId, brief.memberId, brief.dateOfService, ...brief.dxCodes];
}
