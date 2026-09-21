import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { runModeA, startModeA } from '@/domain/mode-a';
import { buildPacket } from '@/domain/packet';
import { buildHistory } from '@/domain/script-runner';
import { PacketView } from '@/ui/PacketView';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';
import { REP_BANK_CALL_06 } from '@fixtures/scripts/rep-bank-call-06';

export const metadata = { title: 'Record of payer statements · The Witness' };

export default function PacketPage() {
  const brief: CallBrief = {
    claimId: CLAIM.id, payer: CLAIM.payer, providerName: 'Harbor Orthopedic Billing', patientLabel: CLAIM.patient,
    memberId: CLAIM.memberId, dateOfService: CLAIM.dateOfService, dxCodes: CLAIM.dxCodes, billed: CLAIM.billed,
    objectives: DEFAULT_OBJECTIVES,
  };
  const history = buildHistory(CLAIM.id, CALLS);
  const done = runModeA(
    startModeA(history.ledger, brief, { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt }, REP_BANK_CALL_06),
  );
  const ledger = done.session.ledger;
  const packet = buildPacket(ledger, {
    claimId: CLAIM.id, payer: CLAIM.payer, memberId: CLAIM.memberId, dateOfService: CLAIM.dateOfService, billed: CLAIM.billed,
  });
  return <PacketView packet={packet} ledger={ledger} />;
}
