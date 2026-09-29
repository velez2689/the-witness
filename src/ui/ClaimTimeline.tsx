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
 * drops a leader line to its true date on the axis, so the nudge never lies about when
 * a call happened.
 */

const MIN_GAP_PCT = 10.4; // ~112px of separation on a typical track width

/** First of each month strictly inside the axis, so the ruler is labelled for any claim. */
function monthMarks(dos: string, days: number): string[] {
  const out: string[] = [];
  const start = new Date(`${dos}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return out;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  while (daysBetween(dos, d.toISOString().slice(0, 10)) < days - 4) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
    if (out.length > 24) break; // a claim older than two years does not need a mark a month
  }
  return out;
}

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
  /** The claim's date of service: the left edge of the axis. Varies per claim, so never a constant. */
  dateOfService: string;
  historyCalls: readonly HistoryCall[];
  ledger: ClaimLedger;
  contradictions: readonly Contradiction[];
  focus: Contradiction | null;
  liveStartedAt: string;
  /** The id the live call's statements carry in the ledger. */
  liveCallId: string;
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
  const DOS = p.dateOfService;
  // The axis runs from the date of service to a little past the newest call, whenever that is.
  const lastDay = [...p.historyCalls.map((c) => c.startedAt), p.liveStartedAt].reduce(
    (a, b) => (a > b ? a : b),
    p.liveStartedAt,
  );
  const AXIS_DAYS = Math.max(daysBetween(DOS, lastDay) * 1.06, 30);
  const MONTHS = monthMarks(DOS, AXIS_DAYS);
  const pctOf = (iso: string) => Math.min(100, Math.max(0, (daysBetween(DOS, iso) / AXIS_DAYS) * 100));

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

  /*
   * The link: from the earlier statement's call to the one that contradicted it.
   *
   * Before a call starts there is no live flag, but the record already holds contradictions
   * between earlier calls, and the screen should show what the product does before anyone
   * presses Start. So at idle the worst contradiction already on record is drawn in grey and
   * labelled as on record; the moment a live flag fires it takes over in flag colour.
   */
  const onRecord = !p.running && !p.focus ? [...p.contradictions].sort((a, b) => b.severity - a.severity)[0] ?? null : null;
  const focus = p.focus ?? onRecord;
  const linkFrom = focus ? cards.find((c) => c.id === callOf(focus.statementIds[0])) : undefined;
  const linkToId = focus ? callOf(focus.statementIds[1]) : undefined;
  const linkTo = cards.find((c) => c.id === linkToId || (c.live && linkToId !== undefined && !p.historyCalls.some((h) => h.id === linkToId)));
  const showLink = Boolean(focus && linkFrom && linkTo && linkFrom !== linkTo);
  const describe = (f: Contradiction) =>
    f.kind === 'value_conflict' && f.sameBadge
      ? `same badge · ${f.daysApart} days · two answers`
      : f.kind === 'existence_denial'
        ? `payer's own reference · ${f.daysApart} days earlier`
        : f.kind === 'commitment_violation'
          ? `told to wait · ${f.daysApart} days elapsed`
          : `${f.kind.replace(/_/g, ' ')} · ${f.daysApart} days apart`;
  const linkLabel = !focus ? '' : onRecord ? `on record · ${describe(focus)}` : describe(focus);

  return (
    <section className="w-claim" aria-label="Claim timeline">
      <header className="w-claim-head">
        <h2>
          <Icon name="clock" size={15} />
          <span>Claim timeline</span>
        </h2>
        <p className="w-note">
          {p.historyCalls.length === 0
            ? `date of service ${shortDate(DOS)} · no prior calls on file · this is call 1`
            : `date of service ${shortDate(DOS)} · ${cards.length} calls · hold time drawn to scale under each call`}
        </p>
      </header>

      <div className={onRecord && showLink ? 'w-claim-track on-record' : 'w-claim-track'}>
        {showLink && linkFrom && linkTo && (
          <>
            <svg className="w-link-line" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={`${linkFrom.pct},34 ${linkFrom.pct},14 ${linkTo.pct},14 ${linkTo.pct},34`}
                fill="none"
                stroke={onRecord ? 'var(--ink-soft)' : 'var(--flag)'}
                strokeWidth={2.5}
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
          const rep = c.live ? repOf(p.ledger, p.liveCallId) : repOf(p.ledger, c.id);
          const ref = callReference(p.ledger, c.live ? p.liveCallId : c.id);
          const isFlagged = flagged.has(c.live ? p.liveCallId : c.id);
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
              onClick={() => p.onSelectCall?.(c.live ? p.liveCallId : c.id)}
              aria-label={`Call ${c.number}, ${shortDate(c.startedAt)}${rep ? `, ${rep}` : ', no rep identified'}`}
            >
              <span className="band" aria-hidden="true" />
              <span className="row">
                <b className="id">{String(c.number).padStart(2, '0')}</b>
                {c.live && p.running ? (
                  <span className="livelabel">
                    <span className="pulse" aria-hidden="true" />
                    live
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
              className={`w-axis-dot${flagged.has(c.live ? p.liveCallId : c.id) ? ' flagged' : ''}${c.live ? ' live' : ''}`}
              style={{ left: `${c.truePct}%` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
