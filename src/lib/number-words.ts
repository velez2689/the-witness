const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  thirtieth: 30,
};
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** "thirty" -> 30, "twenty-one" -> 21, "21" -> 21. null when not a number. */
export function parseNumberWords(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 1) {
    if (parts[0] in ONES) return ONES[parts[0]];
    if (parts[0] in TENS) return TENS[parts[0]];
    return null;
  }
  if (parts.length === 2 && parts[0] in TENS && parts[1] in ONES && ONES[parts[1]] < 10) {
    return TENS[parts[0]] + ONES[parts[1]];
  }
  return null;
}

/** "fifth" -> 5, "twenty-sixth" -> 26, "thirtieth" -> 30, "5th" -> 5. */
export function parseOrdinal(input: string): number | null {
  const s = input.trim().toLowerCase();
  const digits = /^(\d{1,2})(st|nd|rd|th)$/.exec(s);
  if (digits) return Number(digits[1]);
  const parts = s.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 1) return ORDINALS[parts[0]] ?? null;
  if (parts.length === 2 && parts[0] in TENS && parts[1] in ORDINALS && ORDINALS[parts[1]] < 10) {
    return TENS[parts[0]] + ORDINALS[parts[1]];
  }
  return null;
}

const ORDINAL_WORDS: Record<number, string> = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh',
  8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh', 12: 'twelfth', 13: 'thirteenth',
  14: 'fourteenth', 15: 'fifteenth', 16: 'sixteenth', 17: 'seventeenth', 18: 'eighteenth',
  19: 'nineteenth', 20: 'twentieth', 30: 'thirtieth',
};

/** 8 -> "eighth", 26 -> "twenty-sixth". */
export function sayOrdinal(n: number): string {
  if (ORDINAL_WORDS[n]) return ORDINAL_WORDS[n];
  const tens = Math.floor(n / 10) * 10;
  const ones = n % 10;
  const tensWord = Object.entries(TENS).find(([, v]) => v === tens)?.[0];
  return `${tensWord}-${ORDINAL_WORDS[ones]}`;
}

/** 30 -> "thirty", 21 -> "twenty-one". Supports 0-99. */
export function sayNumber(n: number): string {
  if (n < 20) return Object.entries(ONES).find(([k, v]) => v === n && k !== 'oh')![0];
  const tens = Math.floor(n / 10) * 10;
  const ones = n % 10;
  const tensWord = Object.entries(TENS).find(([, v]) => v === tens)![0];
  return ones === 0 ? tensWord : `${tensWord}-${DIGIT_WORDS[ones]}`;
}

export function sayDigit(d: string): string {
  return DIGIT_WORDS[Number(d)];
}

/** Spoken digit word -> digit char, else null. */
export function digitWord(token: string): string | null {
  const t = token.toLowerCase();
  const v = ONES[t];
  return v !== undefined && v < 10 ? String(v) : null;
}
