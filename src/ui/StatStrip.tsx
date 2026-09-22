import { holdLabel } from '@/lib/time';
import { Icon, type IconName } from './Icon';

/**
 * The claim's record at a glance. These are not vanity metrics: hold time, cost and the
 * contradiction count are the evidence this product exists to produce, so they get the
 * largest type on the screen. Deliberately a hairline-separated strip rather than a row
 * of bordered KPI tiles.
 */
export interface Stat {
  label: string;
  value: string;
  icon: IconName;
  tone?: 'flag' | 'accent';
}

export function buildStats(input: {
  calls: number;
  holdSeconds: number;
  costPerCall: number;
  statements: number;
  contradictions: number;
  refusals: number;
}): Stat[] {
  return [
    { label: 'calls on this claim', value: String(input.calls), icon: 'list' },
    { label: 'on hold', value: holdLabel(input.holdSeconds), icon: 'clock' },
    {
      label: `staff cost at $${input.costPerCall.toFixed(2)} a call`,
      value: `$${(input.calls * input.costPerCall).toFixed(2)}`,
      icon: 'user',
    },
    { label: 'statements on record', value: String(input.statements), icon: 'file' },
    {
      label: 'contradictions',
      value: String(input.contradictions),
      icon: 'alert',
      tone: input.contradictions > 0 ? 'flag' : undefined,
    },
    {
      label: 'refusals to answer',
      value: String(input.refusals),
      icon: 'ban',
      tone: input.refusals > 0 ? 'flag' : undefined,
    },
  ];
}

export function StatStrip({ stats }: { stats: readonly Stat[] }) {
  return (
    <section className="w-stats" aria-label="Claim record at a glance">
      {stats.map((s) => (
        <div key={s.label} className={s.tone ? `w-stat-block ${s.tone}` : 'w-stat-block'}>
          <span className="w-stat-label">
            <Icon name={s.icon} size={13} />
            {s.label}
          </span>
          <span className="w-stat-value id">{s.value}</span>
        </div>
      ))}
    </section>
  );
}
