import type { CallBrief } from '@/domain/call-brief';
import type { ClaimLedger } from '@/domain/claim-ledger';
import type { RepBank } from '@/domain/mode-a';
import type { ScriptCall } from '@/domain/script';

export interface HistoryCall {
  id: string;
  number: number;
  startedAt: string;
  durationSeconds: number;
  holdSeconds: number;
}

/** Everything the console needs, as serializable props. The UI never fetches. */
export interface ConsoleProps {
  brief: CallBrief;
  patientLabel: string;
  historyLedger: ClaimLedger;
  historyCalls: readonly HistoryCall[];
  live: ScriptCall;
  bank: RepBank;
  /** Per-call average from the CAQH Index (2024 edition, 2023 data year). */
  costPerCall: number;
}
