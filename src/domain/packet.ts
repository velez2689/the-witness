import type { ClaimLedger } from './claim-ledger';
import type { Contradiction } from './contradiction';
import { detect } from './engine';
import { chain, ledgerHash } from './integrity';
import { callReference } from './speech';
import type { Statement } from './statement';
import { daysBetween, shortDate } from '@/lib/dates';
import { clockLabel } from '@/lib/time';

/**
 * The appeal packet model: the claim's payer statements as quotable evidence, with citations
 * (rep, badge, reference number, date, offset into the call recording), the contradictions between
 * them, every refusal, and a hash that commits to the whole log. Pure data; the page only renders it.
 */
export interface PacketHeader {
  claimId: string;
  payer: string;
  /** Member ID with everything but the last 4 masked (PHI scrub). */
  memberMasked: string;
  dateOfService: string;
  billed: number;
}

export interface PacketCitation {
  statementId: string;
  date: string;
  offset: string;
  rep: string;
  reference: string | null;
  field: string;
  value: string;
  quote: string;
  state: 'confirmed' | 'unconfirmed' | 'refused';
  hash: string;
}

export interface PacketConflict {
  id: string;
  kind: string;
  daysApart: number;
  sameBadge: boolean;
  earlier: PacketCitation;
  later: PacketCitation;
}

export interface Packet {
  header: PacketHeader;
  callCount: number;
  citations: PacketCitation[];
  conflicts: PacketConflict[];
  refusals: PacketCitation[];
  ledgerHash: string;
}

export function maskMember(id: string): string {
  return id.length <= 4 ? id : `${'*'.repeat(id.length - 4)}${id.slice(-4)}`;
}

function citationOf(ledger: ClaimLedger, s: Statement, hashes: Map<string, string>): PacketCitation {
  const ref = callReference(ledger, s.callId);
  return {
    statementId: s.id,
    date: shortDate(s.capturedAt),
    offset: clockLabel(s.span.startMs),
    rep: s.speaker ? `${s.speaker.name}, badge ${s.speaker.badge}` : 'representative did not identify',
    reference: ref?.value ?? null,
    field: s.kind === 'fact' ? s.category.replace(/_/g, ' ') : `${s.category.replace(/_/g, ' ')} (refused)`,
    value: s.kind === 'fact' ? s.value : 'not provided',
    quote: s.span.quote,
    state: s.kind === 'refusal' ? 'refused' : s.confidence === 'captured_confirmed' ? 'confirmed' : 'unconfirmed',
    hash: hashes.get(s.id) ?? '',
  };
}

export function buildPacket(
  ledger: ClaimLedger,
  header: Omit<PacketHeader, 'memberMasked'> & { memberId: string },
): Packet {
  const hashes = new Map(chain(ledger).map((l) => [l.statementId, l.hash]));
  const cite = (s: Statement) => citationOf(ledger, s, hashes);
  const evidence = ledger.statements.filter(
    (s) => s.kind === 'refusal' || (s.kind === 'fact' && s.category !== 'rep_identity' && s.confirms === undefined),
  );
  const conflicts = detect(ledger).map((c: Contradiction): PacketConflict => {
    const earlier = ledger.statements.find((s) => s.id === c.statementIds[0])!;
    const later = ledger.statements.find((s) => s.id === c.statementIds[1])!;
    return {
      id: c.id,
      kind: c.kind.replace(/_/g, ' '),
      daysApart: daysBetween(earlier.capturedAt, later.capturedAt),
      sameBadge: c.sameBadge,
      earlier: cite(earlier),
      later: cite(later),
    };
  });
  return {
    header: {
      claimId: header.claimId,
      payer: header.payer,
      memberMasked: maskMember(header.memberId),
      dateOfService: header.dateOfService,
      billed: header.billed,
    },
    callCount: new Set(ledger.statements.map((s) => s.callId)).size,
    citations: evidence.filter((s) => s.kind === 'fact').map(cite),
    conflicts: conflicts.sort((a, b) => b.daysApart - a.daysApart),
    refusals: evidence.filter((s) => s.kind === 'refusal').map(cite),
    ledgerHash: ledgerHash(ledger),
  };
}
