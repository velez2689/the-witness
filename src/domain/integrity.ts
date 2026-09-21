import type { ClaimLedger } from './claim-ledger';
import type { Statement } from './statement';
import { sha256Hex } from '@/lib/sha256';
import { stableStringify } from '@/lib/stable-json';

/**
 * Tamper-evident ledger: each statement's hash covers the previous hash and the statement's own
 * content, so changing, removing or reordering any row changes every hash after it. The chain is
 * DERIVED from the ledger (never stored as truth) and can be recomputed by anyone holding the log.
 */
export const GENESIS = '0'.repeat(64);

function canonical(s: Statement): string {
  return stableStringify(s);
}

export interface ChainLink {
  statementId: string;
  hash: string;
}

export function chain(ledger: ClaimLedger): ChainLink[] {
  const links: ChainLink[] = [];
  let prev = GENESIS;
  for (const s of ledger.statements) {
    prev = sha256Hex(`${prev}|${canonical(s)}`);
    links.push({ statementId: s.id, hash: prev });
  }
  return links;
}

/** The single hash that commits to the whole log. */
export function ledgerHash(ledger: ClaimLedger): string {
  const links = chain(ledger);
  return links.length ? links[links.length - 1].hash : GENESIS;
}

export function verifyLedger(ledger: ClaimLedger, expected: string): boolean {
  return ledgerHash(ledger) === expected;
}
