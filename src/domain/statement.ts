export type ClaimId = string;
export type CallId = string;

export interface Speaker {
  name: string;
  badge: string;
}

/**
 * Never render as a percentage. This is the only vocabulary the UI is allowed
 * to use for how sure we are of a captured value.
 */
export type ConfidenceState = 'captured_confirmed' | 'captured_unconfirmed' | 'not_captured';

export interface VerbatimSpan {
  quote: string;
  startMs: number;
  endMs: number;
}

interface StatementBase {
  id: string;
  claimId: ClaimId;
  callId: CallId;
  capturedAt: string;
  /** null when the rep declined to identify themselves (call 03 in the demo corpus). */
  speaker: Speaker | null;
  referenceNumber: string | null;
  span: VerbatimSpan;
  confidence: ConfidenceState;
}

export type StatementCategory =
  | 'denial_reason'
  | 'status'
  | 'commitment'
  | 'existence_claim'
  | 'reference_number';

/** A statement that asserts a value the contradiction engine can compare against history. */
export interface FactStatement extends StatementBase {
  kind: 'fact';
  category: StatementCategory;
  value: string;
}

/**
 * The payer names a category but withholds the value ("it's a diagnosis code" —
 * won't say which). Not a contradiction: a first-class row, the absence is the evidence.
 */
export interface RefusalStatement extends StatementBase {
  kind: 'refusal';
  category: string;
}

export type Statement = FactStatement | RefusalStatement;
