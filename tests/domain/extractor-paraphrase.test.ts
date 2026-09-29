import { describe, expect, it } from 'vitest';
import { extractFromTurn, type AskKind, type ExtractContext } from '@/domain/extractor';

/**
 * Held-out phrasings: ways a payer representative could say what the demo corpus says, none of
 * them taken from fixtures/scripts/claim-A-4471-08.ts or from the saved live calls. The extractor
 * is rule-based on purpose (the model never touches evidence), so this file is the honest measure
 * of how far the rules reach: each list is a family of wordings that must type to one fact, and
 * each "must not" list is a wording that must NOT, because a false fact in the ledger is worse
 * than a missed one. A wording in neither list is filed as a verbatim quote and typed by nobody.
 */

const ctx = (over: Partial<ExtractContext> = {}): ExtractContext => ({
  capturedAt: '2026-09-29T12:00:00Z',
  identity: { first: null, badge: null },
  askedFor: null,
  knownReps: [],
  nameHint: null,
  ...over,
});
const turn = (text: string) => ({ text, startMs: 0, endMs: 4000 });

/** The values of the typed facts in one category that a turn produces. */
function values(text: string, category: string, over: Partial<ExtractContext> = {}): string[] {
  return extractFromTurn(turn(text), ctx(over))
    .drafts.filter((d) => d.kind === 'fact' && d.category === category)
    .map((d) => (d.kind === 'fact' ? d.value : ''));
}

const denialReasons = (text: string) => values(text, 'denial_reason');

describe('extractor: denial reasons said in words the corpus does not use', () => {
  it.each([
    'We never received a prior authorization for this service.',
    'There is no authorization on file.',
    'Prior authorization was not obtained.',
    'The claim is missing prior authorization.',
    "Prior authorization isn't on file.",
  ])('no prior authorization: "%s"', (text) => {
    expect(denialReasons(text)).toEqual(['no prior authorization']);
  });

  it.each([
    'It was filed too late.',
    'The claim is past the filing deadline.',
    'We are outside the filing window.',
    'The filing limit was missed.',
  ])('timely filing: "%s"', (text) => {
    expect(denialReasons(text)).toEqual(['timely filing']);
  });

  it.each([
    'There is a problem with the diagnosis code.',
    'It was denied because of the diagnosis.',
    'The diagnosis does not support the service.',
    'The diagnosis code is invalid.',
  ])('diagnosis: "%s"', (text) => {
    expect(denialReasons(text)).toEqual(['diagnosis code']);
  });

  it.each([
    'That service is not a covered benefit.',
    "That service isn't covered.",
    'The procedure is excluded from the plan.',
    'There is no coverage for that service.',
  ])('non-covered: "%s"', (text) => {
    expect(denialReasons(text)).toEqual(['non-covered']);
  });

  it.each(['There is a wrong billing code on the claim.', 'We found a coding problem.', 'The CPT code was rejected.'])(
    'procedure code: "%s"',
    (text) => {
      expect(denialReasons(text)).toEqual(['procedure code']);
    },
  );

  it.each([
    'The prior authorization was obtained and approved.',
    'Prior authorization is not required for this service.',
    'We received the claim on time.',
    'The diagnosis on file is M54.5.',
    'That service is covered under your plan.',
    'Which code do you mean?',
  ])('does not invent a reason from: "%s"', (text) => {
    expect(denialReasons(text)).toEqual([]);
  });
});

describe('extractor: status, commitments and existence claims in other words', () => {
  it.each(['It is still processing.', 'The claim is being processed.', 'It is still pending.'])(
    'in process: "%s"',
    (text) => {
      expect(values(text, 'status')).toEqual(['in process']);
    },
  );

  it('does not call a claim in process because someone said "wait"', () => {
    expect(values('Please wait while I check.', 'status')).toEqual([]);
  });

  it('types a wait as a commitment with its window', () => {
    const wait = extractFromTurn(turn('Please wait thirty days.'), ctx()).drafts.find(
      (d) => d.kind === 'fact' && d.category === 'commitment',
    );
    expect(wait && wait.kind === 'fact' && wait.value).toBe('wait 30 days');
    expect(wait && wait.kind === 'fact' && wait.windowDays).toBe(30);
    expect(values('It takes up to 45 days.', 'commitment')).toEqual(['wait 45 days']);
  });

  it('does not invent a commitment without a number of days', () => {
    expect(values('Please wait a few days.', 'commitment')).toEqual([]);
    expect(values('Please wait.', 'commitment')).toEqual([]);
  });

  it.each([
    'I have no record of that call.',
    'I am not seeing a call on that date.',
    'I cannot find that call.',
    'We do not have a record of the call.',
  ])('existence denial: "%s"', (text) => {
    expect(values(text, 'existence_claim')).toEqual(['no record of call']);
  });

  it('does not deny a call the Rep confirms', () => {
    expect(values('I do have a record of that call.', 'existence_claim')).toEqual([]);
    expect(values('Yes, I can see that call.', 'existence_claim')).toEqual([]);
  });
});

describe('extractor: a refusal is recorded in other words, and only after the Agent asked', () => {
  const asked: AskKind = 'diagnosis_code';
  const refusals = (text: string, askedFor: AskKind | null) =>
    extractFromTurn(turn(text), ctx({ askedFor })).drafts.filter((d) => d.kind === 'refusal');

  it.each([
    'I am not able to share that.',
    "I can't share that with you.",
    'That is not something I can see.',
    'I do not see that on my screen.',
    'I am unable to provide that.',
  ])('refusal: "%s"', (text) => {
    const found = refusals(text, asked);
    expect(found).toHaveLength(1);
    expect(found[0].kind === 'refusal' && found[0].category).toBe('diagnosis_code');
  });

  it('records nothing when nothing was asked for', () => {
    expect(refusals("I can't share that with you.", null)).toEqual([]);
  });

  it('records no refusal when the Rep gave the value', () => {
    expect(refusals('The diagnosis code is M54.5.', asked)).toEqual([]);
  });
});
