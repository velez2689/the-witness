'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ClaimUpdate } from '@/domain/claim-update';
import { speak } from './speak';

const STATE_WORD = { confirmed: 'confirmed', unconfirmed: 'unconfirmed', refused: 'refused · recorded', missing: 'NOT CAPTURED' } as const;

/** Every field the Agent needs to update the claim, each with the quote behind it. */
export function ClaimUpdateSheet({ update }: { update: ClaimUpdate }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(update.note);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="w-update" aria-label="Claim update sheet">
      <div>
        <h2>Claim update sheet · what to write on the claim</h2>
        <table>
          <tbody>
            {update.rows.map((r, i) => (
              <tr key={`${r.field}-${i}`}>
                <td>{r.field}</td>
                <td className={r.state === 'refused' || r.state === 'missing' ? 'bad' : ''}>
                  <span className="id">{r.value}</span>
                  {r.state !== 'confirmed' && <span className="w-note"> · {STATE_WORD[r.state]}</span>}
                </td>
                <td>
                  {r.quote && (
                    <button className="w-play" style={{ margin: 0 }} onClick={() => speak(r.quote!)} aria-label={`Play the quote behind ${r.field}`}>▶</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Claim note · paste into the PM system</h2>
        <pre className="w-note-box">{update.note}</pre>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="w-btn primary" onClick={copy}>Copy claim note</button>
          {copied && <span role="status" className="w-note">copied</span>}
          <Link className="w-btn" href="/packet" style={{ textDecoration: 'none' }}>Open appeal packet →</Link>
        </div>
      </div>
    </section>
  );
}
