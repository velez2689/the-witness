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

/** What a live call reports back to the UI. Structural twin of the service events (the UI never imports services). */
export interface LiveHandlers {
  status(s: 'connecting' | 'live' | 'closed' | 'error', detail?: string): void;
  rep(e: {
    text: string;
    added: import('@/domain/statement').Statement[];
    contradictions: import('@/domain/contradiction').Contradiction[];
    engineMs: number;
    atMs: number;
  }): void;
  witness(e: { text: string; cites: readonly string[]; tag: string; atMs: number }): void;
  latency(e: { flagMs: number; speakMs: number | null }): void;
  drift(unknown: string[]): void;
  done(reason: string): void;
}

export interface LiveSession {
  start(): Promise<void>;
  stop(reason: string): void;
}

/** Injected by the app host: creates a live call bound to real services. Absent = scripted only. */
export interface LiveDriver {
  create(
    input: {
      brief: import('@/domain/call-brief').CallBrief;
      ledger: import('@/domain/claim-ledger').ClaimLedger;
      call: { callId: string; capturedAt: string; repSurname?: string | null };
    },
    handlers: LiveHandlers,
  ): LiveSession;
  /** Close every open session (Reset, unmount). */
  closeAll(reason: string): void;
}
