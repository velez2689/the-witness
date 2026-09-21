'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ClaimLedger } from '@/domain/claim-ledger';
import { verifyLedger } from '@/domain/integrity';
import type { Packet, PacketCitation } from '@/domain/packet';
import { speak } from './speak';

function Cite({ c }: { c: PacketCitation }) {
  return (
    <div className="pk-cite">
      <p className="pk-quote">
        <span className="said">{c.quote}</span>
        <button className="w-play no-print" onClick={() => speak(c.quote)} aria-label="Play this quote">Play</button>
      </p>
      <p className="pk-meta">
        <span className="id">{c.date} · call offset {c.offset}</span> · {c.rep}
        {c.reference ? <> · reference <span className="id">{c.reference}</span></> : ' · no reference number issued'}
        {' · '}{c.field}: <b>{c.value}</b> · <span className={`pk-state ${c.state}`}>{c.state}</span>
        <span className="id pk-hash" title="Hash of the ledger up to and including this statement"> · #{c.hash.slice(0, 10)}</span>
      </p>
    </div>
  );
}

export function PacketView({ packet, ledger }: { packet: Packet; ledger: ClaimLedger }) {
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const download = () => {
    const blob = new Blob([JSON.stringify({ packet, statements: ledger.statements }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `witness-evidence-${packet.header.claimId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <main className="pk">
      <div className="no-print pk-bar">
        <Link href="/">← Console</Link>
        <span className="w-spacer" />
        <button className="w-btn" onClick={() => window.print()}>Print / save as PDF</button>
        <button className="w-btn" onClick={download}>Download evidence (JSON)</button>
        <button className="w-btn" onClick={() => setVerdict(verifyLedger(ledger, packet.ledgerHash))}>Verify integrity</button>
        {verdict !== null && (
          <span role="status" style={{ color: verdict ? 'var(--confirm)' : 'var(--flag)', fontWeight: 600 }}>
            {verdict ? '✓ hash recomputed from the log matches' : '✕ the log does not match its hash'}
          </span>
        )}
      </div>

      <h1>Record of payer statements</h1>
      <p className="pk-sub">
        Claim <span className="id">{packet.header.claimId}</span> · {packet.header.payer} · member <span className="id">{packet.header.memberMasked}</span> · date of service{' '}
        <span className="id">{packet.header.dateOfService}</span> · billed <span className="id">${packet.header.billed.toFixed(2)}</span> · {packet.callCount} calls
      </p>
      <p className="pk-note">
        Synthetic demonstration data. Every statement below was captured from a call recording with the rep&apos;s words,
        rep name and badge, reference number and offset into the recording. Nothing is inferred, scored or adjudicated;
        this is a record of what was said, not legal advice.
      </p>

      <h2>1 · Statements that conflict</h2>
      {packet.conflicts.length === 0 && <p>No conflicts on record.</p>}
      {packet.conflicts.map((k) => (
        <section key={k.id} className="pk-conflict">
          <h3>
            {k.kind}{k.sameBadge ? ' · same badge' : ''} · {k.daysApart} days apart
          </h3>
          <Cite c={k.earlier} />
          <Cite c={k.later} />
        </section>
      ))}

      <h2>2 · What the payer would not say</h2>
      <p className="pk-note">A refusal is recorded as an attributable row: the absence is the evidence.</p>
      {packet.refusals.map((r) => <Cite key={r.statementId} c={r} />)}

      <h2>3 · Every captured statement, in order</h2>
      {packet.citations.map((c) => <Cite key={c.statementId} c={c} />)}

      <h2>4 · Why these records matter</h2>
      <p>
        The U.S. Department of Labor&apos;s Employee Benefits Security Administration stated in an Information Letter dated
        June 14, 2021 that, under 29 CFR 2560.503-1(h)(2)(iii), audio recordings and transcripts of conversations with plan
        representatives are documents relevant to a claim. This packet gives a provider the record of those conversations that
        the provider&apos;s own notes usually lack.
      </p>

      <h2>5 · Integrity</h2>
      <p className="id" style={{ wordBreak: 'break-all' }}>ledger hash · {packet.ledgerHash}</p>
      <p className="pk-note">
        Each statement&apos;s hash covers the one before it. Changing, removing or reordering any row changes every hash after
        it. Use “Verify integrity” to recompute the hash from the log in this page.
      </p>
    </main>
  );
}
