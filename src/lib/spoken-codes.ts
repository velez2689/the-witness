import { digitWord } from './number-words';

/**
 * X12 codes as a Rep says them on the phone.
 *
 *   "remark code N thirty"        -> remark  N30
 *   "N three zero", "n30", "N-30" -> remark  N30
 *   "M A one thirty"              -> remark  MA130
 *   "claim status code twenty one"-> status  21
 *   "CO fifty", "CO-50", "P R two oh four" -> carc CO-50, PR-204
 *
 * Only the identifier is recognised; nothing here knows what any code means.
 */
export interface SpokenCode {
  kind: 'remark' | 'status' | 'carc';
  code: string;
}

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const CARC_GROUPS = new Set(['co', 'pr', 'oa', 'pi', 'cr']);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"()[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** A number of one to three digits starting at token i, spoken or written. Returns the digits and tokens used. */
function numberAt(tokens: string[], i: number): { digits: string; used: number } | null {
  const t = tokens[i];
  if (t === undefined) return null;
  if (/^\d{1,3}$/.test(t)) return { digits: String(Number(t)), used: 1 };
  // Digit by digit: "three zero", "two oh four".
  let digits = '';
  let j = i;
  while (j < tokens.length && digitWord(tokens[j]) !== null && digits.length < 3) {
    digits += digitWord(tokens[j]);
    j += 1;
  }
  if (digits.length >= 2) return { digits: String(Number(digits)), used: j - i };
  // As a number: "thirty", "twenty one", "one thirty", "two hundred four".
  let value: number | null = null;
  let used = 0;
  if (t in ONES && ONES[t] < 10 && tokens[i + 1] === 'hundred') {
    value = ONES[t] * 100;
    used = 2;
    const rest = numberAt(tokens, i + 2);
    if (rest && rest.digits.length <= 2) {
      value += Number(rest.digits);
      used += rest.used;
    }
  } else if (t in ONES && ONES[t] < 10 && tokens[i + 1] in TENS) {
    value = ONES[t] * 100 + TENS[tokens[i + 1]];
    used = 2;
    if (tokens[i + 2] in ONES && ONES[tokens[i + 2]] < 10) {
      value += ONES[tokens[i + 2]];
      used = 3;
    }
  } else if (t in TENS) {
    value = TENS[t];
    used = 1;
    if (tokens[i + 1] in ONES && ONES[tokens[i + 1]] < 10) {
      value += ONES[tokens[i + 1]];
      used = 2;
    }
  } else if (t in ONES) {
    value = ONES[t];
    used = 1;
  }
  return value === null ? null : { digits: String(value), used };
}

export function findSpokenCodes(text: string): SpokenCode[] {
  const out: SpokenCode[] = [];
  const seen = new Set<string>();
  const push = (c: SpokenCode) => {
    const k = `${c.kind}:${c.code}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  };
  const tokens = tokenize(text);

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];

    // Written as one token: "n30", "ma-130", "co-50", "pr204".
    const one = /^(ma|m|n|co|pr|oa|pi|cr)-?(\d{1,3})$/.exec(t);
    if (one) {
      const prefix = one[1].toUpperCase();
      const n = String(Number(one[2]));
      if (CARC_GROUPS.has(one[1])) push({ kind: 'carc', code: `${prefix}-${n}` });
      else push({ kind: 'remark', code: `${prefix}${n}` });
      continue;
    }

    // Spoken prefix then a number: "N thirty", "M A one thirty", "CO fifty", "C O fifty".
    let prefix: string | null = null;
    let after = i + 1;
    if (t === 'm' && tokens[i + 1] === 'a') {
      prefix = 'MA';
      after = i + 2;
    } else if (t === 'ma' || t === 'm' || t === 'n') prefix = t.toUpperCase();
    else if (CARC_GROUPS.has(t)) prefix = t.toUpperCase();
    else if (/^[cpo]$/.test(t) && /^[oria]$/.test(tokens[i + 1] ?? '') && CARC_GROUPS.has(t + tokens[i + 1])) {
      prefix = (t + tokens[i + 1]).toUpperCase();
      after = i + 2;
    }
    if (prefix) {
      if (tokens[after] === 'dash') after += 1;
      const num = numberAt(tokens, after);
      if (num) {
        if (CARC_GROUPS.has(prefix.toLowerCase())) push({ kind: 'carc', code: `${prefix}-${num.digits}` });
        else push({ kind: 'remark', code: `${prefix}${num.digits}` });
        i = after + num.used - 1;
        continue;
      }
    }

    // "status code 21", "claim status twenty one", "claim status code is 21".
    if ((t === 'status' && tokens[i + 1] === 'code') || (t === 'claim' && tokens[i + 1] === 'status')) {
      let k = i + 2;
      if (tokens[k] === 'code') k += 1;
      if (tokens[k] === 'is' || tokens[k] === 'of') k += 1;
      const num = numberAt(tokens, k);
      if (num) {
        push({ kind: 'status', code: num.digits });
        i = k + num.used - 1;
      }
    }
  }
  return out;
}
