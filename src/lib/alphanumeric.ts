import { digitWord, sayDigit } from './number-words';

export interface AlnumRun {
  /** Compact form, e.g. "8K2J988". */
  raw: string;
  /** Index of the first token of the run in the token list. */
  start: number;
  /** Token count. */
  length: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"()[\]—–]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** One token to its alnum character, or null. "seven" -> "7", "k" -> "K", "8k2j" -> "8K2J". */
function toAlnum(token: string): string | null {
  const d = digitWord(token);
  if (d !== null) return d;
  if (/^[a-z]$/.test(token)) return token.toUpperCase();
  if (/^[a-z0-9]+$/.test(token) && /\d/.test(token) && token.length <= 12) return token.toUpperCase();
  return null;
}

/**
 * Finds runs of spoken or written alphanumerics of at least `minChars` characters.
 * Handles "eight K two J nine eight eight", "8K2J-988" and "eight-K-two-J-nine-eight-eight".
 * Single letters only join a run when they are adjacent to digits or other letters in the run,
 * so "a" / "i" in normal prose do not start one.
 */
export function findAlnumRuns(text: string, minChars = 6): AlnumRun[] {
  // A sentence end breaks a run: "...seven zero two. 4 minutes" is two things, not one number.
  return text
    .split(/[.?!]+(?=\s|$)/)
    .flatMap((sentence) => findRunsInSentence(sentence, minChars));
}

function findRunsInSentence(text: string, minChars: number): AlnumRun[] {
  const tokens = tokenize(text);
  const runs: AlnumRun[] = [];
  let i = 0;
  while (i < tokens.length) {
    const first = toAlnum(tokens[i]);
    const nextIsAlnum = i + 1 < tokens.length && toAlnum(tokens[i + 1]) !== null;
    const isProse = first !== null && (tokens[i] === 'a' || tokens[i] === 'i') && !nextIsAlnum;
    if (first === null || isProse) {
      i += 1;
      continue;
    }
    let j = i;
    let raw = '';
    while (j < tokens.length) {
      const c = toAlnum(tokens[j]);
      if (c === null) break;
      raw += c;
      j += 1;
    }
    if (raw.length >= minChars && /\d/.test(raw)) {
      runs.push({ raw, start: i, length: j - i });
    }
    i = j === i ? i + 1 : j;
  }
  return runs;
}

/** Spoken digits only: "two two one zero" -> "2210". Returns null unless exactly `count` digits. */
export function parseSpokenDigits(text: string, count: number): string | null {
  const tokens = tokenize(text);
  let out = '';
  for (const t of tokens) {
    const d = digitWord(t) ?? (/^\d+$/.test(t) ? t : null);
    if (d === null) continue;
    out += d;
  }
  return out.length === count ? out : null;
}

/** "8K2J988" -> "8K2J-988" when it matches the payer reference format, else unchanged. */
export function formatReference(raw: string): string {
  const m = /^(\d[A-Z]\d[A-Z])(\d{3})$/.exec(raw);
  return m ? `${m[1]}-${m[2]}` : raw;
}

/** "8K2J-988" -> "eight K two J nine eight eight" for speech (chunked, unambiguous). */
/**
 * Render an identifier for TTS, one character at a time, keeping the groups it already has.
 *
 * The hyphen becomes a SEMICOLON rather than being stripped. Punctuation is the only prosody
 * control that exists: the output config is {voice, format, volume}, with no rate, pitch or SSML.
 * So the marks were measured rather than guessed - same identifier, same voice, one render each:
 *
 *     semicolon  +32%      comma  0%      double comma  -2%      period  -2%      dash  -22%
 *
 * The semicolon wins twice. It is the only mark that slows the voice appreciably, and it is
 * invisible to the fabrication self-check: `tokenize` strips it and `findAlnumRuns` does not
 * treat it as a sentence end, so an identifier stays ONE verifiable run. A period reads at the
 * same speed AND splits the run into fragments too short to check, which would have quietly
 * disarmed the guard against the Witness speaking a reference number that is not in the record.
 *
 * A long ungrouped value is chunked into threes for the same reason: nobody reads seven
 * characters aloud in a single breath. Short ones are left alone - a four-digit badge said as
 * "two two one, zero" is worse than saying it straight, which is what an earlier version of
 * this function did to every badge on the call.
 */
const CHUNK_ABOVE = 6;

export function spellForSpeech(value: string): string {
  const groups = value.includes('-')
    ? value.split('-').filter(Boolean)
    : value.replace(/[^A-Za-z0-9]/g, '').length > CHUNK_ABOVE
      ? (value.match(/.{1,3}/g) ?? [value])
      : [value];
  return groups
    .map((g) =>
      g
        .split('')
        .map((c) => (/\d/.test(c) ? sayDigit(c) : c))
        .join(' '),
    )
    .join('; ');
}

/** Levenshtein distance, for near-match against known reference candidates. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}
