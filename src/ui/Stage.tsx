import type { Contradiction } from '@/domain/contradiction';
import { clockLabel, holdLabel, type FeedItem } from './call-feed';
import type { Mode } from './use-call-runner';

/**
 * Band 4 of the console: the live call as an audio-editor track view.
 *
 * SVG is the right tool here — this is a waveform/track visualisation with a time ruler,
 * where geometry is the content. The claim timeline above it is HTML (see ClaimTimeline)
 * because that one is type-heavy and needed real font sizes.
 */

const X0 = 70;
const X1 = 1150;
const W = X1 - X0;
const TRACK_X = X0 + 100;
const HOLD_GAP = 44;

const MARK_Y = 20;
const REP_Y = 32;
const WIT_Y = 78;
const TRACK_H = 34;
const RULER_Y = 130;
const HEIGHT = 178;

interface Props {
  shown: readonly FeedItem[];
  focus: Contradiction | null;
  mode: Mode;
  totalMs: number;
}

function layoutBlocks(shown: readonly FeedItem[], scale: number) {
  let holds = 0;
  const out: { item: FeedItem; x: number; w: number; holdBefore: number }[] = [];
  for (const i of shown) {
    if (i.side === 'closeout') continue;
    if (i.holdSeconds > 0) holds += 1;
    out.push({
      item: i,
      x: TRACK_X + 10 + i.atMs * scale + holds * HOLD_GAP,
      w: Math.max(6, i.durationMs * scale),
      holdBefore: i.holdSeconds,
    });
  }
  return out;
}

export function Stage(p: Props) {
  const scale = (W - 120) / Math.max(p.totalMs, 60_000);
  const blocks = layoutBlocks(p.shown, scale);
  const target = p.focus
    ? blocks.find((b) => b.item.added.some((s) => s.id === p.focus!.statementIds[1]))
    : undefined;

  return (
    <svg
      viewBox={`0 0 1200 ${HEIGHT}`}
      role="img"
      aria-label="Live call track: the Rep's channel above, the Witness's channel below, with a marker at every captured statement"
    >
      <text x={X0} y={REP_Y + 19} className="mono">Rep</text>
      <text x={X0} y={REP_Y + 31} className="mono" style={{ fontSize: 10 }}>channel A</text>
      <text x={X0} y={WIT_Y + 21} className="mono">{p.mode === 'A' ? 'Witness' : 'Agent'}</text>

      <rect x={TRACK_X} y={REP_Y} width={X1 - TRACK_X} height={TRACK_H} rx={5} fill="var(--panel)" stroke="var(--rule)" />
      <rect x={TRACK_X} y={WIT_Y} width={X1 - TRACK_X} height={TRACK_H} rx={5} fill="var(--panel)" stroke="var(--rule)" />
      <line x1={TRACK_X} x2={X1} y1={REP_Y + TRACK_H / 2} y2={REP_Y + TRACK_H / 2} stroke="var(--rule)" strokeDasharray="1 4" opacity={0.6} />
      <line x1={TRACK_X} x2={X1} y1={WIT_Y + TRACK_H / 2} y2={WIT_Y + TRACK_H / 2} stroke="var(--rule)" strokeDasharray="1 4" opacity={0.6} />

      {blocks.map((b) => {
        const rep = b.item.side === 'rep';
        const y = rep ? REP_Y : WIT_Y;
        const fill = rep ? 'var(--ink)' : b.item.side === 'whisper' ? 'var(--signal)' : 'var(--accent)';
        return (
          <g key={b.item.id}>
            {b.holdBefore > 0 && (
              <g>
                <rect
                  x={b.x - HOLD_GAP + 2}
                  y={REP_Y}
                  width={HOLD_GAP - 4}
                  height={WIT_Y + TRACK_H - REP_Y}
                  rx={4}
                  fill="var(--hold)"
                  stroke="var(--ink-soft)"
                  strokeDasharray="3 3"
                />
                <text x={b.x - HOLD_GAP / 2} y={REP_Y + 44} textAnchor="middle" className="mono" style={{ fontSize: 10 }}>hold</text>
                <text x={b.x - HOLD_GAP / 2} y={REP_Y + 57} textAnchor="middle" className="mono" style={{ fontSize: 10 }}>{holdLabel(b.holdBefore)}</text>
              </g>
            )}
            <rect x={b.x} y={y + 6} width={b.w} height={TRACK_H - 12} rx={3} fill={fill} opacity={b.item.side === 'whisper' ? 0.85 : 0.9} />
            {b.item.side === 'whisper' && (
              <text x={b.x} y={y + TRACK_H + 11} className="mono" style={{ fontSize: 9.5, fill: 'var(--signal)' }}>earpiece</text>
            )}
            {b.item.added.map((s, k) => {
              const cx = b.x + 6 + k * 13;
              if (s.kind === 'refusal') {
                return (
                  <text key={s.id} x={cx} y={MARK_Y + 4} textAnchor="middle" style={{ fill: 'var(--flag)', fontSize: 13, fontWeight: 700 }}>
                    x
                  </text>
                );
              }
              const d = `M ${cx} ${MARK_Y - 5} l 5 5 l -5 5 l -5 -5 z`;
              if (s.confirms) return <path key={s.id} d={d} fill="var(--confirm)" />;
              return s.confidence === 'captured_confirmed' ? (
                <path key={s.id} d={d} fill="var(--ink)" />
              ) : (
                <path key={s.id} d={d} fill="none" stroke="var(--signal)" strokeWidth={1.8} />
              );
            })}
          </g>
        );
      })}

      {target && (
        <g>
          <rect
            x={target.x - 5}
            y={REP_Y - 6}
            width={Math.max(target.w, 60) + 10}
            height={TRACK_H + 12}
            rx={5}
            fill="var(--flag-wash)"
            stroke="var(--flag)"
            strokeWidth={2}
          />
          <text x={target.x - 5} y={REP_Y - 12} style={{ fill: 'var(--flag)', fontWeight: 700, fontSize: 11 }} className="mono">
            CONTRADICTION · {p.focus?.kind.replace(/_/g, ' ')}
          </text>
        </g>
      )}

      <line x1={TRACK_X} x2={X1} y1={RULER_Y} y2={RULER_Y} stroke="var(--rule)" />
      {[0, 15, 30, 45, 60, 75, 90, 105, 120].map((s) => (
        <text key={s} x={TRACK_X + 10 + s * 1000 * scale} y={RULER_Y + 16} className="mono" style={{ fontSize: 10 }}>
          {clockLabel(s * 1000)}
        </text>
      ))}
      <g transform={`translate(${TRACK_X} ${RULER_Y + 20})`} className="mono" style={{ fontSize: 10 }}>
        <path d="M 6 6 l 5 5 l -5 5 l -5 -5 z" fill="var(--ink)" />
        <text x={16} y={14}>captured</text>
        <path d="M 86 6 l 5 5 l -5 5 l -5 -5 z" fill="none" stroke="var(--signal)" strokeWidth={1.8} />
        <text x={96} y={14}>unconfirmed</text>
        <path d="M 186 6 l 5 5 l -5 5 l -5 -5 z" fill="var(--confirm)" />
        <text x={196} y={14}>confirmed</text>
        <text x={262} y={14} style={{ fill: 'var(--flag)', fontWeight: 700 }}>x refused</text>
      </g>
    </svg>
  );
}
