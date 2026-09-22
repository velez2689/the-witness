'use client';

import type { QuarantinedTurn, RosterGate, WrongClaimWarning } from '@/domain/call-roster';
import { Icon } from './Icon';
import type { RosterLineItem } from './use-roster';

/**
 * One call, several patients — the batch a biller actually makes.
 *
 * The band exists to make one rule visible: the active patient is chosen by the Agent, never
 * inferred from what the rep says. When the rep reads the wrong member ID, the Witness challenges
 * them on the line and NOTHING moves between ledgers.
 */

interface Props {
  gates: readonly RosterGate[];
  items: readonly RosterLineItem[];
  segment: number;
  segmentDone: boolean;
  running: boolean;
  started: boolean;
  atLastPatient: boolean;
  canEnd: boolean;
  outstanding: readonly RosterGate[];
  openWarning: { warning: WrongClaimWarning; resolved: boolean; held: QuarantinedTurn | null } | null;
  leadDone: boolean;
  onBegin: () => void;
  onNext: () => void;
  onReset: () => void;
  onRelease: (quarantineId: string, claimId: string) => void;
  onDiscard: (quarantineId: string) => void;
}

/** One line per thing the held turn would record, so the Agent rules on content, not on a count. */
function heldContents(held: QuarantinedTurn): string[] {
  return held.contains.map((c) =>
    c.kind === 'refusal' ? `refusal: ${c.category.replace(/_/g, ' ')}` : `${c.category.replace(/_/g, ' ')}: ${c.value}`,
  );
}

function shortOf(g: RosterGate): string[] {
  return g.items.filter((i) => i.required && i.state === 'missing').map((i) => i.label.toLowerCase());
}

export function RosterBand(p: Props) {
  const captured = (g: RosterGate) => g.items.filter((i) => i.required && i.state !== 'missing').length;
  const total = (g: RosterGate) => g.items.filter((i) => i.required).length;

  return (
    <section className="w-roster" aria-label="Patients on this call">
      <header className="w-roster-head">
        <h2>
          <Icon name="list" size={15} />
          <span>Patients on this call</span>
        </h2>
        <p className="w-note">
          {p.started
            ? `one call · ${p.gates.length} patients · one IVR, one hold queue`
            : 'a biller does not hang up after one claim — the IVR and the hold queue cost 25 minutes, so they batch'}
        </p>
        <span className="w-spacer" />
        {!p.started && p.leadDone && (
          <button type="button" className="w-btn primary" onClick={p.onBegin}>
            <Icon name="arrowRight" size={15} />
            While I have you: 2 more
          </button>
        )}
        {p.started && p.segmentDone && !p.atLastPatient && (
          <button type="button" className="w-btn primary" onClick={p.onNext}>
            <Icon name="arrowRight" size={15} />
            Next patient
          </button>
        )}
        {p.started && (
          <button type="button" className="w-btn" onClick={p.onReset}>
            Reset batch
          </button>
        )}
      </header>

      {!p.started && !p.leadDone && (
        <div className="w-empty">
          <p className="w-note" style={{ margin: 0 }}>
            The batch opens when the first claim is worked. Each patient keeps its own ledger and its own
            exit gate; the call cannot close while any of them is short a required field.
          </p>
        </div>
      )}

      {p.started && (
        <>
          <ol className="w-roster-list">
            {p.gates.map((g, i) => {
              const short = shortOf(g);
              const state = g.clear ? 'clear' : g.active ? 'active' : 'short';
              return (
                <li key={g.claimId} className={`w-pt ${state}${g.active ? ' is-active' : ''}`}>
                  <span className="w-pt-band" aria-hidden="true" />
                  <span className="w-pt-top">
                    <b>{String(i + 1).padStart(2, '0')}</b>
                    <span className="w-pt-name">{g.patientLabel}</span>
                    {g.active && <span className="w-pt-now">ON NOW</span>}
                  </span>
                  <span className="id w-pt-claim">{g.claimId}</span>
                  <span className="w-pt-gate">
                    <Icon name={g.clear ? 'check' : 'alert'} size={13} />
                    {captured(g)}/{total(g)} required captured
                  </span>
                  {short.length > 0 && <span className="w-pt-short">short: {short.join(', ')}</span>}
                </li>
              );
            })}
          </ol>

          {p.openWarning && (
            <div className={`w-wrongclaim${p.openWarning.resolved ? ' resolved' : ''}`} role="alert">
              <span className="w-wc-tag">
                <Icon name={p.openWarning.resolved ? 'check' : 'ban'} size={15} />
                {p.openWarning.resolved ? 'WRONG CLAIM · CHALLENGED, CORRECTED' : 'WRONG CLAIM'}
              </span>
              <p>
                The rep read <span className="id">{p.openWarning.warning.spoken}</span> — that is{' '}
                <b>{p.openWarning.warning.spokenPatient}</b> ({p.openWarning.warning.spokenClaimId}), not the patient on
                screen ({p.openWarning.warning.expectedClaimId}).
              </p>
              <p className="w-note">
                Nothing was filed to either ledger from that turn. A silent re-route would manufacture exactly the
                contamination this is here to prevent — so the Witness challenges the rep on the line and the Agent decides.
                {p.openWarning.resolved && ' The rep re-stated it against the right patient and that answer was captured.'}
              </p>

              {p.openWarning.held && (
                <div className="w-held">
                  <p className="w-held-title">
                    <Icon name="pending" size={14} />
                    Held, not discarded — the rep did say this:
                  </p>
                  <blockquote className="w-held-quote">{p.openWarning.held.turn.text}</blockquote>
                  {heldContents(p.openWarning.held).length > 0 ? (
                    <ul className="w-held-list">
                      {heldContents(p.openWarning.held).map((line) => (
                        <li key={line} className="id">
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="w-note" style={{ margin: '4px 0 8px' }}>
                      Nothing extractable in it — no value would be recorded either way.
                    </p>
                  )}
                  <p className="w-note" style={{ margin: '0 0 9px' }}>
                    It describes <b>{p.openWarning.warning.spokenPatient}</b> if the rep was reading their chart, or
                    nothing at all if they simply misspoke. That is your call, not ours.
                  </p>
                  <div className="w-held-acts">
                    <button
                      type="button"
                      className="w-btn"
                      onClick={() => p.onRelease(p.openWarning!.held!.id, p.openWarning!.warning.spokenClaimId)}
                    >
                      <Icon name="arrowRight" size={14} />
                      File to {p.openWarning.warning.spokenPatient} ({p.openWarning.warning.spokenClaimId})
                    </button>
                    <button type="button" className="w-btn warn" onClick={() => p.onDiscard(p.openWarning!.held!.id)}>
                      <Icon name="x" size={14} />
                      Rep misspoke — record nothing
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {p.items.length > 0 && (
            <ul className="w-roster-feed">
              {p.items.map((it) => (
                <li key={it.key} className={`${it.side}${it.warning ? ' flagged' : ''}`}>
                  <span className="w-rf-who id">{it.side === 'rep' ? 'REP' : 'AGENT'}</span>
                  <span className="w-rf-text">{it.text}</span>
                  <span className="id w-rf-dest">
                    {it.warning ? 'not filed' : it.addedCount > 0 ? `${it.addedCount} to ${it.claimId}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className={`w-roster-verdict ${p.canEnd ? 'ok' : 'open'}`}>
            {p.canEnd
              ? 'Every patient on this call is clear. The call may end.'
              : p.outstanding.length > 0
                ? `Do not hang up: ${p.outstanding.map((g) => g.patientLabel).join(', ')} still short a required field.`
                : 'Do not hang up: a held turn is still waiting on your decision. Hanging up loses what the rep said.'}
          </div>
        </>
      )}
    </section>
  );
}
