import type { ClaimLedger } from '@/domain/claim-ledger';
import type { Contradiction } from '@/domain/contradiction';
import { callReference } from '@/domain/speech';
import type { FactStatement } from '@/domain/statement';
import { daysBetween, shortDate } from '@/lib/dates';
import { holdLabel } from '@/lib/time';
import { Icon } from './Icon';
import type { HistoryCall } from './console-types';

/**
 * Band 2 of the console: the claim's whole life on a date axis.
 *
 * This is HTML, not SVG, on purpose. The earlier SVG version scaled as one fixed-aspect
 * unit, so every label rendered at the same ~11px no matter what the CSS said and no
 * hover, shadow or type scale could reach it. Real elements mean real type sizes.
 *
 * Cards sit at their date, nudged apart only as far as legibility requires, and each one
 * drops a leader line to its true date on the axis — so the nudge never lies about when
 * a call happened.
 */

const DOS = '2026-05-18';
const AXIS_DAYS = 106; // May 18 -> Sep 1
const MIN_GAP_PCT = 10.4; // ~112px of separation on a typical track width
const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];

const pctOf = (iso: string) => Math.min(100, Math.max(0, (daysBetween(DOS, iso) / AXIS_DAYS) * 100));

interface Placed {
  id: string;
  number: number;
  startedAt: string;
  durationSeconds: number;
  holdSeconds: number;
  truePct: number;
  pct: number;
  live: boolean;
}

interface Props {
  historyCalls: readonly HistoryCall[];
  ledger: ClaimLedger;
  contradictions: readonly Contradiction[];
  focus: Contradiction | null;
  liveStartedAt: string;
  liveDuration: number;
  liveNumber: number;
  holdSeconds: number;
  running: boolean;
  onSelectCall?: (callId: string) => void;
}

function repOf(ledger: ClaimLedger, callId: string): string | null {
  const s = ledger.statements.find(
    (x): x is FactStatement => x.callId === callId && x.kind === 'fact' && x.category === 'rep_identity',
  );
  return s ? s.value : null;
}

/** Left-to-right pass that pushes a card right only when it would collide with the previous one. */
function place(all: Omit<Placed, 'pct'>[]): Placed[] {
  const sorted = [...all].sort((a, b) => a.truePct - b.truePct);
  const out: Placed[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    const pct = prev && c.truePct < prev.pct + MIN_GAP_PCT ? prev.pct + MIN_GAP_PCT : c.truePct;
    out.push({ ...c, pct });
  }
  return out;
}

export function ClaimTimeline(p: Props) {
  const flagged = new Set<string>();
  const callOf = (id: string) => p.ledger.statements.find((s) => s.id === id)?.callId;
  for (const c of p.contradictions) {
    for (const id of c.statementIds) {
      const call = callOf(id);
      if (call) flagged.add(call);
    }
  }

  const cards = place([
    ...p.historyCalls.map((c) => ({
      id: c.id,
      number: c.number,
      startedAt: c.startedAt,
      durationSeconds: c.durationSeconds,
      holdSeconds: c.holdSeconds,
      truePct: pctOf(c.startedAt),
      live: false,
    })),
    {
      id: 'live',
      number: p.liveNumber,
      startedAt: p.liveStartedAt,
      durationSeconds: p.liveDuration,
      holdSeconds: p.holdSeconds,
      truePct: pctOf(p.liveStartedAt),
      live: true,
    },
  ]);

  // The link: from the earlier statement's call to the one that contradicted it.
  const linkFrom = p.focus ? cards.find((c) => c.id === callOf(p.focus!.statementIds[0])) : undefined;
  const linkToId = p.focus ? callOf(p.focus.statementIds[1]) : undefined;
  const linkTo = cards.find((c) => c.id === linkToId || (c.live && linkToId !== undefined && !p.historyCalls.some((h) => h.id === linkToId)));
  const showLink = Boolean(p.focus && linkFrom && linkTo && linkFrom !== linkTo);
  const linkLabel = !p.focus
    ? ''
    : p.focus.kind === 'value_conflict' && p.focus.sameBadge
      ? `same badge · ${p.focus.daysApart} days · two answers`
      : p.focus.kind === 'existence_denial'
        ? `payer's own reference · ${p.focus.daysApart} days earlier`
        : p.focus.kind === 'commitment_violation'
          ? `told to wait · ${p.focus.daysApart} days elapsed`
          : `${p.focus.kind.replace(/_/g, ' ')} · ${p.focus.daysApart} days apart`;

  return (
    <section className="w-claim" aria-label="Claim timeline">
      <header className="w-claim-head">
        <h2>
          <Icon name="clock" size={15} />
          <span>Claim timeline</span>
        </h2>
        <p className="w-note">
          date of service {shortDate(DOS)} · {cards.length} calls · hold time drawn to scale under each call
        </p>
      </header>

      <div className="w-claim-track">
        {showLink && linkFrom && linkTo && (
          <>
            <svg className="w-link-line" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={`${linkFrom.pct},34 ${linkFrom.pct},14 ${linkTo.pct},14 ${linkTo.pct},34`}
                fill="none"
                stroke="var(--flag)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span className="w-link-dot" style={{ left: `${linkTo.pct}%` }} aria-hidden="true" />
            <span className="w-link-chip" style={{ left: `${(linkFrom.pct + linkTo.pct) / 2}%` }}>
              <Icon name="alert" size={13} />
              {linkLabel}
            </span>
          </>
        )}

        {cards.map((c) => {
          const rep = c.live ? repOf(p.ledger, 'call-06') : repOf(p.ledger, c.id);
          const ref = callReference(p.ledger, c.live ? 'call-06' : c.id);
          const isFlagged = flagged.has(c.live ? 'call-06' : c.id);
          // Everything on this claim is involved in some contradiction, so a red border on
          // all six would mean nothing. Only the pair being examined gets the full treatment.
          const isFocus = showLink && (c.id === linkFrom?.id || c.id === linkTo?.id);
          const holdPct = Math.min(100, (c.holdSeconds / Math.max(c.durationSeconds, 1)) * 100);
          const cls = [
            'w-call',
            isFlagged ? 'flagged' : '',
            isFocus ? 'focus' : '',
            c.live ? (p.running ? 'live' : 'pending') : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={c.id}
              type="button"
              className={cls}
              style={{ left: `${c.pct}%` }}
              onClick={() => p.onSelectCall?.(c.live ? 'call-06' : c.id)}
              aria-label={`Call ${c.number}, ${shortDate(c.startedAt)}${rep ? `, ${rep}` : ', no rep identified'}`}
            >
              <span className="band" aria-hidden="true" />
              <span className="row">
                <b className="id">{String(c.number).padStart(2, '0')}</b>
                {c.live && p.running ? (
                  <span className="livelabel">
                    <span className="pulse" aria-hidden="true" />
                    LIVE
                  </span>
                ) : (
                  <span className="id when">{shortDate(c.startedAt)}</span>
                )}
              </span>
              {c.live && !p.running ? (
                <span className="who pendinglabel">this call</span>
              ) : (
                <>
                  <span className={rep ? 'who' : 'who missing'}>
                    {rep ? rep.slice(0, rep.lastIndexOf(' ')) : 'no rep ID'}
                  </span>
                  <span className="id badge">{rep ? `badge ${rep.slice(rep.lastIndexOf(' ') + 1)}` : ''}</span>
                  <span className={ref ? 'id refno' : 'id refno missing'}>{ref ? ref.value : 'no ref'}</span>
                </>
              )}
              {c.holdSeconds > 0 && (
                <span className="hold" title={`${holdLabel(c.holdSeconds)} on hold`}>
                  <span className="hold-bar" aria-hidden="true">
                    <span style={{ width: `${holdPct}%` }} />
                  </span>
                  <span className="hold-label id">{holdLabel(c.holdSeconds)}</span>
                </span>
              )}
            </button>
          );
        })}

        <svg className="w-lead" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          {cards.map((c) => (
            <line
              key={c.id}
              x1={c.pct}
              y1={0}
              x2={c.truePct}
              y2={36}
              stroke="var(--rule)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        <div className="w-axis" aria-hidden="true">
          <span className="w-axis-mark dos" style={{ left: '0%' }}>
            <i />
            DOS
          </span>
          {MONTHS.map((m) => (
            <span
              key={m}
              className="w-axis-mark"
              style={{ left: `${pctOf(m)}%` }}
              data-end={pctOf(m) > 95 ? 'true' : undefined}
            >
              <i />
              {shortDate(m).slice(0, 3)} 1
            </span>
          ))}
          {cards.map((c) => (
            <span
              key={c.id}
              className={`w-axis-dot${flagged.has(c.live ? 'call-06' : c.id) ? ' flagged' : ''}${c.live ? ' live' : ''}`}
              style={{ left: `${c.truePct}%` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
