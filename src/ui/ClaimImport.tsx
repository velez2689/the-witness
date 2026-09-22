'use client';

import { useRef } from 'react';
import {
  MAX_CLAIMS_PER_CALL,
  isUsable,
  selectionBlocked,
  type ImportResult,
  type ImportedClaim,
} from '@/domain/claim-import';
import { Icon } from './Icon';

/**
 * The front door: a biller's AR worklist, straight out of Epic, Cerner or Meditech.
 *
 * The file is read in the page and never uploaded — a worklist is full of PHI and this project
 * has no BAA. The panel says so plainly rather than burying it, because a biller is the one
 * person who will immediately wonder.
 */

interface Props {
  fileName: string | null;
  sheetName: string | null;
  result: ImportResult | null;
  busy: boolean;
  error: string | null;
  /** Claim ids the Agent has ticked. */
  selected: readonly string[];
  loaded: boolean;
  onPick: (file: File) => void;
  onToggle: (claim: ImportedClaim) => void;
  onLoad: () => void;
  onClear: () => void;
}

const money = (n: number | null) => (n === null ? '' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

export function ClaimImport(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const claims = p.result?.claims ?? [];
  const usable = claims.filter(isUsable).length;
  const atCap = p.selected.length >= MAX_CLAIMS_PER_CALL;

  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (f) p.onPick(f);
  };

  return (
    <section className="w-import" aria-label="Import claims from a worklist">
      <header className="w-import-head">
        <h2>
          <Icon name="file" size={15} />
          <span>Claims on this call</span>
        </h2>
        <p className="w-note">
          {p.result
            ? `${p.fileName}${p.sheetName ? ` · ${p.sheetName}` : ''} · ${claims.length} rows, ${usable} usable`
            : 'upload the AR worklist your billing system already exports'}
        </p>
        <span className="w-spacer" />
        {p.result && (
          <button type="button" className="w-btn" onClick={p.onClear}>
            Use a different file
          </button>
        )}
      </header>

      {!p.result && (
        <div
          className={`w-drop${p.busy ? ' busy' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            take(e.dataTransfer.files);
          }}
        >
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xlsm,.csv,.tsv,.txt"
            className="sr-only"
            onChange={(e) => take(e.currentTarget.files)}
          />
          <Icon name="file" size={26} />
          <p className="w-drop-main">{p.busy ? 'Reading the file…' : 'Drop your AR worklist here'}</p>
          <p className="w-note">
            .xlsx or .csv from Epic, Cerner, Meditech or any system that exports an AR follow-up list.
          </p>
          <div className="w-drop-acts">
            <button type="button" className="w-btn primary" disabled={p.busy} onClick={() => input.current?.click()}>
              Choose a file
            </button>
            <a className="w-btn" href="/sample-ar-worklist.xlsx" download>
              <Icon name="arrowRight" size={14} />
              Download a sample worklist
            </a>
          </div>
          <p className="w-privacy">
            <Icon name="shield" size={13} />
            Your file is read in this browser and never uploaded. Nothing leaves this machine.
          </p>
        </div>
      )}

      {p.error && (
        <p role="alert" className="w-import-error">
          <Icon name="alert" size={14} />
          {p.error}
        </p>
      )}

      {p.result && claims.length > 0 && (
        <>
          <p className="w-cap">
            <Icon name={atCap ? 'check' : 'pending'} size={14} />
            {p.selected.length} of {MAX_CLAIMS_PER_CALL} selected
            <span className="w-note">
              {' '}
              · payers allow {MAX_CLAIMS_PER_CALL} claim-status inquiries per representative on one call
            </span>
          </p>

          <div className="w-table-wrap">
            <table className="w-table">
              <thead>
                <tr>
                  <th scope="col" className="pick">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col">Claim</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Member ID</th>
                  <th scope="col">Payer</th>
                  <th scope="col">Date of service</th>
                  <th scope="col" className="num">
                    Billed
                  </th>
                  <th scope="col">
                    <span className="sr-only">Problems</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => {
                  const on = p.selected.includes(c.claimId);
                  const blocked = on ? null : selectionBlocked(p.selected.length, c);
                  return (
                    <tr key={`${c.row}-${c.claimId}`} className={`${on ? 'on' : ''}${isUsable(c) ? '' : ' bad'}`}>
                      <td className="pick">
                        <label className="w-check" title={blocked ?? undefined}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={Boolean(blocked) || p.loaded}
                            onChange={() => p.onToggle(c)}
                          />
                          <span className="w-check-box" aria-hidden="true" />
                          <span className="sr-only">
                            {c.claimId} {c.patientLabel}
                          </span>
                        </label>
                      </td>
                      <td className="id">{c.claimId || <em>row {c.row}</em>}</td>
                      <td>{c.patientLabel || <span className="w-note">not named</span>}</td>
                      <td className="id">{c.memberId}</td>
                      <td>{c.payer}</td>
                      <td className="id">{c.dateOfService}</td>
                      <td className="num id">{money(c.billed)}</td>
                      <td className="problem">
                        {c.problems.length > 0 && (
                          <>
                            <Icon name="alert" size={13} />
                            {c.problems.join(', ')}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="w-import-foot">
            <button
              type="button"
              className="w-btn primary"
              disabled={p.selected.length === 0 || p.loaded}
              onClick={p.onLoad}
            >
              <Icon name="arrowRight" size={15} />
              {p.loaded
                ? 'Loaded into the call'
                : `Put ${p.selected.length || 'these'} ${p.selected.length === 1 ? 'claim' : 'claims'} on the call`}
            </button>
            <span className="w-note">
              Each selected claim gets its own ledger and its own exit gate. Nothing is merged.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
