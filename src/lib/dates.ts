import { parseOrdinal, sayOrdinal } from './number-words';

export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

const MS_PER_DAY = 86_400_000;

/** ISO date (YYYY-MM-DD) of an ISO timestamp, without timezone conversion. */
export function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${isoDate(fromIso)}T00:00:00Z`);
  const b = Date.parse(`${isoDate(toIso)}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${isoDate(iso)}T00:00:00Z`) + days * MS_PER_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

/** "August fifth" / "August 5th" -> "2026-08-05" using the given reference year. */
export function parseMonthDay(text: string, year: number): string | null {
  const m = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+([a-z0-9-]+(?:\s[a-z]+)?)/i.exec(
    text,
  );
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase() as (typeof MONTHS)[number]) + 1;
  const words = m[2].toLowerCase().split(/\s+/);
  for (const take of [2, 1]) {
    const day = parseOrdinal(words.slice(0, take).join(' '));
    if (day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

/** "2026-07-08" -> "July eighth" (spoken form). */
export function sayDate(iso: string): string {
  const [, mm, dd] = isoDate(iso).split('-').map(Number);
  const month = MONTHS[mm - 1];
  return `${month[0].toUpperCase()}${month.slice(1)} ${sayOrdinal(dd)}`;
}

/** "2026-07-08" -> "Jul 08" (display form). */
export function shortDate(iso: string): string {
  const [, mm, dd] = isoDate(iso).split('-').map(Number);
  const month = MONTHS[mm - 1];
  return `${month[0].toUpperCase()}${month.slice(1, 3)} ${String(dd).padStart(2, '0')}`;
}
