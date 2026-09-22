import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { buildHistory } from '@/domain/script-runner';
import { ConsoleHost } from './console-host';
import type { HistoryCall } from '@/ui/console-types';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';
import { REP_BANK_CALL_06 } from '@fixtures/scripts/rep-bank-call-06';
import { ROSTER_BATCH } from '@fixtures/scripts/roster-batch';

/** CAQH Index 2024 edition (2023 data): $13.80 per manual phone claim-status inquiry. */
const COST_PER_CALL = 13.8;

export default function Home() {
  // Built at request time from the synthetic corpus: the history is the same pipeline a live call uses.
  const history = buildHistory(CLAIM.id, CALLS);
  const brief: CallBrief = {
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
  const historyCalls: HistoryCall[] = CALLS.map((c) => ({
    id: c.id,
    number: c.number,
    startedAt: c.startedAt,
    durationSeconds: c.durationSeconds,
    holdSeconds: c.holdSeconds,
  }));

  return (
    <ConsoleHost
      brief={brief}
      patientLabel={CLAIM.patient}
      historyLedger={history.ledger}
      historyCalls={historyCalls}
      live={LIVE_CALL}
      bank={REP_BANK_CALL_06}
      batch={ROSTER_BATCH}
      costPerCall={COST_PER_CALL}
    />
  );
}
