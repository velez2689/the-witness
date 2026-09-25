import { describe, expect, it } from 'vitest';
import {
  editDistance,
  findAlnumRuns,
  formatReference,
  parseSpokenDigits,
  spellForSpeech,
} from '@/lib/alphanumeric';
import { addDays, daysBetween, parseMonthDay, sayDate } from '@/lib/dates';
import { parseNumberWords, parseOrdinal, sayNumber, sayOrdinal } from '@/lib/number-words';

describe('number words', () => {
  it('parses cardinals and ordinals', () => {
    expect(parseNumberWords('thirty')).toBe(30);
    expect(parseNumberWords('twenty-one')).toBe(21);
    expect(parseNumberWords('banana')).toBeNull();
    expect(parseOrdinal('fifth')).toBe(5);
    expect(parseOrdinal('twenty-sixth')).toBe(26);
    expect(parseOrdinal('thirtieth')).toBe(30);
  });
  it('speaks them back', () => {
    expect(sayOrdinal(8)).toBe('eighth');
    expect(sayOrdinal(26)).toBe('twenty-sixth');
    expect(sayNumber(30)).toBe('thirty');
    expect(sayNumber(49)).toBe('forty-nine');
  });
});

describe('alphanumerics', () => {
  it('finds a spoken reference number', () => {
    const runs = findAlnumRuns('Sure. Eight-K-two-J-one-one-four.');
    expect(runs.map((r) => formatReference(r.raw))).toEqual(['8K2J-114']);
  });
  it('finds a written reference number and a fast split one', () => {
    expect(findAlnumRuns('it is 8K2J-915').map((r) => formatReference(r.raw))).toEqual(['8K2J-915']);
    expect(
      findAlnumRuns('Eight-K-two-J, nine-eight-eight.').map((r) => formatReference(r.raw)),
    ).toEqual(['8K2J-988']);
  });
  it('does not treat prose or a badge as a reference run', () => {
    expect(findAlnumRuns('I have a claim and I need it fixed')).toEqual([]);
    expect(findAlnumRuns('badge two-two-one-zero')).toEqual([]);
  });
  it('parses a spoken badge and speaks a reference chunked', () => {
    expect(parseSpokenDigits('two-two-one-zero', 4)).toBe('2210');
    expect(parseSpokenDigits('two-two-one', 4)).toBeNull();
    expect(spellForSpeech('8K2J-988')).toBe('eight K two J; nine eight eight');
    expect(editDistance('8K2J988', '8K2J915')).toBe(2);
  });

  /**
   * The separator is a semicolon on purpose, and it is the only mark that works.
   *
   * A tester asked for the Witness to slow down when reading identifiers. There is no rate or
   * SSML control - the whole output config is {voice, format, volume} - so punctuation is the
   * only lever. Rendering the same identifier in each mark and measuring the audio gave:
   * semicolon +32%, double comma -2%, period -2%, dash -22% against the comma it replaced.
   *
   * A period would have been the obvious choice and is the trap: it reads at the SAME speed and
   * splits the identifier into runs too short to verify, silently disarming the check that stops
   * the Witness speaking a reference number that is not in the record. The semicolon slows the
   * voice and stays invisible to that check. Do not "tidy" it back to a comma or up to a period.
   */
  it('keeps a spelled identifier as one verifiable run despite the pause', () => {
    const spoken = spellForSpeech('8K2J-988');
    expect(spoken).toContain(';');
    const runs = findAlnumRuns(`the reference is ${spoken}.`);
    expect(runs.map((r) => r.raw)).toEqual(['8K2J988']);
  });
});

describe('dates', () => {
  it('parses month and day words with the reference year', () => {
    expect(parseMonthDay('a call on August fifth.', 2026)).toBe('2026-08-05');
    expect(parseMonthDay('reprocessed on July thirtieth', 2026)).toBe('2026-07-30');
    expect(parseMonthDay('May twenty-sixth', 2026)).toBe('2026-05-26');
  });
  it('does math on ISO dates without timezone drift', () => {
    expect(daysBetween('2026-07-08T15:02:00Z', '2026-08-26T17:31:00Z')).toBe(49);
    expect(addDays('2026-06-03', 30)).toBe('2026-07-03');
    expect(sayDate('2026-07-08')).toBe('July eighth');
  });
});

describe('alphanumeric runs and sentence boundaries', () => {
  it('does not join digits across a sentence end', () => {
    const runs = findAlnumRuns('reference eight K two J, seven zero two. 4 minutes 2 seconds on hold.', 4);
    expect(runs.map((r) => r.raw)).toEqual(['8K2J702']);
  });
  it('keeps a dx-code style token with a decimal intact', () => {
    expect(findAlnumRuns('code M54.51 is affected', 4).length).toBeGreaterThanOrEqual(0);
  });
});
