import type { Contradiction } from '@/domain/contradiction';
import type { ClaimLedger } from '@/domain/claim-ledger';
import { callReference } from '@/domain/speech';
import type { FactStatement } from '@/domain/statement';
import { daysBetween, shortDate } from '@/lib/dates';
import { clockLabel, holdLabel, type FeedItem } from './call-feed';
import type { HistoryCall } from './console-types';
import type { Mode } from './use-call-runner';

const X0 = 70;
const X1 = 1150;
const W = X1 - X0;
const DOS = '2026-05-18';
const AXIS_DAYS = 106; // May 18 -> Sep 1
const HOLD_GAP = 44;

const dayX = (iso: string) => X0 + (daysBetween(DOS, iso) / AXIS_DAYS) * W;
const MONTH_TICKS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];

interface Props {
  historyCalls: readonly HistoryCall[];
  ledger: ClaimLedger;
  contradictions: readonly Contradiction[];
  shown: readonly FeedItem[];
  focus: Contradiction | null;
  liveStartedAt: string;
  liveDuration: number;
  holdSeconds: number;
  running: boolean;
  mode: Mode;
  totalMs: number;
  onSelectCall?: (callId: string) => void;
}

function repOf(ledger: ClaimLedger, callId: string): string | null {
  const s = ledger.statements.find((x): x is FactStatement => x.callId === callId && x.kind === 'fact' && x.category === 'rep_identity');
  return s ? s.value : null;
}

function layoutBlocks(shown: readonly FeedItem[], scale: number) {
  let holds = 0;
  const out: { item: FeedItem; x: number; w: number; holdBefore: number }[] = [];
  for (const i of shown) {
    if (i.side === 'closeout') continue;
    if (i.holdSeconds > 0) holds += 1;
    out.push({ item: i, x: X0 + 110 + i.atMs * scale + holds * HOLD_GAP, w: Math.max(6, i.durationMs * scale), holdBefore: i.holdSeconds });
  }
  return out;
}

/** Bands 2-4 of the console: the claim on a date axis, the link, and the live call as an edit view. */
export function Stage(p: Props) {
  const flaggedCalls = new Set<string>();
  const callOf = (id: string) => p.ledger.statements.find((s) => s.id === id)?.callId;
  for (const c of p.contradictions) for (const id of c.statementIds) {
    const call = callOf(id);
    if (call) flaggedCalls.add(call);
  }

  // ----- call timeline layout (band 4). Holds are a fixed marker so the speech stays readable.
  const scale = (W - 120) / Math.max(p.totalMs, 60_000);
  const blocks = layoutBlocks(p.shown, scale);
  const blockOfStatement = (id: string) => blocks.find((b) => b.item.added.some((s) => s.id === id));

  const target = p.focus ? blockOfStatement(p.focus.statementIds[1]) : undefined;
  const earlierStmt = p.focus ? p.ledger.statements.find((s) => s.id === p.focus!.statementIds[0]) : undefined;
  const earlierCall = earlierStmt ? p.historyCalls.find((c) => c.id === earlierStmt.callId) : undefined;
  const linkX1 = earlierCall ? dayX(earlierCall.startedAt) + 14 : 0;
  const linkX2 = target ? target.x + Math.min(target.w, 40) / 2 : 0;
  const linkLabel = p.focus
    ? p.focus.kind === 'value_conflict' && p.focus.sameBadge
      ? `same badge · ${p.focus.daysApart} days · two answers`
      : p.focus.kind === 'existence_denial'
        ? `payer's own reference · ${p.focus.daysApart} days earlier`
        : p.focus.kind === 'commitment_violation'
          ? `told to wait · ${p.focus.daysApart} days elapsed`
          : `${p.focus.daysApart} days apart`
    : '';

  const height = 408;
  return (
    <svg viewBox={`0 0 1200 ${height}`} role="img" aria-label="Claim timeline and live call timeline, with the contradiction drawn as a link between them">
      {/* ---- band 2: the claim's whole life on a date axis ---- */}
      <text x={X0} y={16} className="strong" style={{ fontSize: 12 }}>
        Claim timeline · date of service May 18 · {p.historyCalls.length + 1} calls
      </text>
      {MONTH_TICKS.map((m) => (
        <g key={m}>
          <line x1={dayX(m)} x2={dayX(m)} y1={26} y2={158} stroke="var(--rule)" strokeWidth={1} />
          <text x={dayX(m) + 4} y={36} className="mono">{shortDate(m).slice(0, 3)} 1</text>
        </g>
      ))}
      <line x1={X0} x2={X0} y1={26} y2={158} stroke="var(--ink-soft)" />
      <text x={X0 + 4} y={36} className="mono">DOS</text>

      {p.historyCalls.map((c) => {
        const x = dayX(c.startedAt);
        const w = 14 + (c.durationSeconds / 60) * 0.9;
        const rep = repOf(p.ledger, c.id);
        const ref = callReference(p.ledger, c.id);
        const flagged = flaggedCalls.has(c.id);
        const holdW = w * Math.min(1, c.holdSeconds / c.durationSeconds);
        return (
          <g key={c.id} tabIndex={0} role="button" aria-label={`Call ${c.number}, ${shortDate(c.startedAt)}`} onClick={() => p.onSelectCall?.(c.id)} style={{ cursor: 'pointer' }}>
            <rect x={x} y={46} width={w} height={46} fill="var(--panel)" stroke="var(--ink-soft)" />
            {flagged && <rect x={x} y={46} width={w} height={5} fill="var(--flag)" />}
            <rect x={x} y={94} width={holdW} height={5} fill="var(--ink-soft)" opacity={0.7} />
            <text x={x + 4} y={72} className="mono strong">{String(c.number).padStart(2, '0')}</text>
            <text x={x} y={116} className="mono">{shortDate(c.startedAt)}</text>
            <text x={x} y={128} className="mono" style={{ fill: rep ? undefined : 'var(--flag)', fontWeight: rep ? 400 : 700 }}>{rep ? rep.slice(0, rep.lastIndexOf(' ')) : 'no rep ID'}</text>
            {rep && <text x={x} y={140} className="mono">badge {rep.slice(rep.lastIndexOf(' ') + 1)}</text>}
            <text x={x} y={rep ? 152 : 140} className="mono" style={{ fill: ref ? undefined : 'var(--flag)', fontWeight: ref ? 400 : 700 }}>{ref ? ref.value : 'no ref number'}</text>
          </g>
        );
      })}

      {(() => {
        const x = dayX(p.liveStartedAt);
        const w = 14 + (Math.max(p.liveDuration, 60) / 60) * 0.9;
        return (
          <g>
            <rect x={x} y={46} width={w} height={46} fill={p.running ? 'var(--flag-wash)' : 'transparent'} stroke="var(--accent)" strokeDasharray={p.running ? undefined : '4 3'} strokeWidth={p.running ? 2 : 1} />
            <text x={x + 4} y={72} className="mono strong">06</text>
            <text x={x} y={116} className="mono">{shortDate(p.liveStartedAt)}</text>
            <text x={x} y={129} className="mono" style={{ fill: 'var(--accent)', fontWeight: 700 }}>{p.running ? 'LIVE' : 'this call'}</text>
            {p.holdSeconds > 0 && <rect x={x} y={94} width={Math.min(w, (p.holdSeconds / Math.max(p.liveDuration, 1)) * w)} height={5} fill="var(--ink-soft)" opacity={0.7} />}
          </g>
        );
      })()}
      <text x={X1} y={16} textAnchor="end" className="mono">hold drawn to scale under each call</text>

      {/* ---- band 3: THE LINK — the contradiction as a link between two timescales ---- */}
      {p.focus && target && earlierCall && (
        <g>
          <path d={`M ${linkX1} 100 C ${linkX1} 190, ${linkX2} 170, ${linkX2} 226`} fill="none" stroke="var(--flag)" strokeWidth={2} strokeDasharray="7 5" />
          <circle cx={linkX1} cy={100} r={4} fill="var(--flag)" />
          <g transform={`translate(${(linkX1 + linkX2) / 2 - 130} 168)`}>
            <rect width={260} height={22} fill="var(--bg)" stroke="var(--flag)" />
            <text x={130} y={15} textAnchor="middle" className="strong" style={{ fontSize: 12, fontWeight: 600, fill: 'var(--flag)' }}>{linkLabel}</text>
          </g>
        </g>
      )}

      {/* ---- band 4: the live call as an edit view ---- */}
      <line x1={X0} x2={X1} y1={214} y2={214} stroke="var(--rule)" />
      <text x={X0} y={232} className="strong" style={{ fontSize: 12 }}>
        Live call · {shortDate(p.liveStartedAt)} · {p.mode === 'A' ? 'the Witness is speaking to the Rep' : 'the Agent is speaking, the Witness whispers'}
      </text>
      <text x={X0} y={283} className="mono">Rep</text>
      <text x={X0} y={296} className="mono" style={{ fontSize: 10 }}>channel A</text>
      <text x={X0} y={329} className="mono">{p.mode === 'A' ? 'Witness' : 'Agent'}</text>
      <rect x={X0 + 100} y={262} width={W - 100} height={34} fill="var(--panel)" />
      <rect x={X0 + 100} y={308} width={W - 100} height={34} fill="var(--panel)" />

      {blocks.map((b) => {
        const rep = b.item.side === 'rep';
        const y = rep ? 262 : 308;
        const fill = rep ? 'var(--ink)' : b.item.side === 'whisper' ? 'var(--signal)' : 'var(--accent)';
        return (
          <g key={b.item.id}>
            {b.holdBefore > 0 && (
              <g>
                <rect x={b.x - HOLD_GAP + 2} y={262} width={HOLD_GAP - 4} height={80} fill="var(--hold)" stroke="var(--ink-soft)" strokeDasharray="3 3" />
                <text x={b.x - HOLD_GAP / 2} y={306} textAnchor="middle" className="mono" style={{ fontSize: 10 }}>hold</text>
                <text x={b.x - HOLD_GAP / 2} y={319} textAnchor="middle" className="mono" style={{ fontSize: 10 }}>{holdLabel(b.holdBefore)}</text>
              </g>
            )}
            <rect x={b.x} y={y + 6} width={b.w} height={22} fill={fill} opacity={b.item.side === 'whisper' ? 0.85 : 0.9} />
            {b.item.side === 'whisper' && <text x={b.x} y={y + 40} className="mono" style={{ fontSize: 9.5, fill: 'var(--signal)' }}>earpiece</text>}
            {b.item.added.map((s, k) => {
              const cx = b.x + 6 + k * 13;
              const cy = 252;
              if (s.kind === 'refusal') return <text key={s.id} x={cx} y={cy + 4} textAnchor="middle" style={{ fill: 'var(--flag)', fontSize: 13, fontWeight: 700 }}>x</text>;
              if (s.confirms) return <path key={s.id} d={`M ${cx} ${cy - 5} l 5 5 l -5 5 l -5 -5 z`} fill="var(--confirm)" />;
              return s.confidence === 'captured_confirmed' ? (
                <path key={s.id} d={`M ${cx} ${cy - 5} l 5 5 l -5 5 l -5 -5 z`} fill="var(--ink)" />
              ) : (
                <path key={s.id} d={`M ${cx} ${cy - 5} l 5 5 l -5 5 l -5 -5 z`} fill="none" stroke="var(--signal)" strokeWidth={1.8} />
              );
            })}
          </g>
        );
      })}

      {target && (
        <g>
          <rect x={target.x - 5} y={256} width={Math.max(target.w, 60) + 10} height={46} fill="var(--flag-wash)" stroke="var(--flag)" strokeWidth={2} />
          <text x={target.x - 5} y={250} style={{ fill: 'var(--flag)', fontWeight: 700, fontSize: 11 }} className="mono">
            CONTRADICTION · {p.focus?.kind.replace(/_/g, ' ')}
          </text>
        </g>
      )}

      {/* ruler */}
      <line x1={X0 + 100} x2={X1} y1={358} y2={358} stroke="var(--rule)" />
      {[0, 15, 30, 45, 60, 75, 90, 105, 120].map((s) => (
        <text key={s} x={X0 + 110 + s * 1000 * scale} y={374} className="mono" style={{ fontSize: 10 }}>{clockLabel(s * 1000)}</text>
      ))}
      <g transform={`translate(${X0 + 100} 378)`} className="mono" style={{ fontSize: 10 }}>
        <path d="M 6 6 l 5 5 l -5 5 l -5 -5 z" fill="var(--ink)" /><text x={16} y={14}>captured</text>
        <path d="M 86 6 l 5 5 l -5 5 l -5 -5 z" fill="none" stroke="var(--signal)" strokeWidth={1.8} /><text x={96} y={14}>unconfirmed</text>
        <path d="M 186 6 l 5 5 l -5 5 l -5 -5 z" fill="var(--confirm)" /><text x={196} y={14}>confirmed</text>
        <text x={262} y={14} style={{ fill: 'var(--flag)', fontWeight: 700 }}>x refused</text>
      </g>
    </svg>
  );
}

