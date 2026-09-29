import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, OBJECTIVES, type CallBrief, type ObjectiveKey } from '@/domain/call-brief';
import { initialPlan, nextMove, type PlanState } from '@/domain/call-plan';
import { ingestRepTurn, noteUsLine, startCall } from '@/domain/call-session';
import { createLedger } from '@/domain/claim-ledger';
import { classifyAsk, extractFromTurn, type ExtractContext } from '@/domain/extractor';
import { askIdentityAgain, askObjective } from '@/domain/speech';

/**
 * Every case here is a sentence a real Rep said on the 2026-09-29 live calls
 * (docs/assets/calls/call-2026-09-29T*.zip) that the build of that morning got wrong.
 */

const BRIEF: CallBrief = {
  claimId: 'claim-md5',
  payer: 'Meridian',
  providerName: 'Harbor Orthopedic Billing',
  patientLabel: 'Patient B',
  memberId: 'MD5583-0417',
  dateOfService: '2026-06-02',
  dxCodes: ['M54.5'],
  billed: 410,
  objectives: DEFAULT_OBJECTIVES,
};

const ctx = (over: Partial<ExtractContext> = {}): ExtractContext => ({
  capturedAt: '2026-09-29T12:57:56Z',
  identity: { first: null, badge: null },
  askedFor: null,
  knownReps: [],
  nameHint: null,
  ...over,
});
const turn = (text: string) => ({ text, startMs: 0, endMs: 1000 });

describe('extractor: what the live Reps actually said', () => {
  it('types "non-covered" and "denied for non-coverage" as a denial reason', () => {
    for (const text of ['Non-covered.', 'The claim is denied for non-coverage.', "It's not covered under the plan."]) {
      const facts = extractFromTurn(turn(text), ctx()).drafts.filter((d) => d.kind === 'fact' && d.category === 'denial_reason');
      expect(facts.map((f) => f.kind === 'fact' && f.value)).toEqual(['non-covered']);
    }
  });

  it('types "an issue with the CPT code" as a procedure-code reason, a category with no value', () => {
    const facts = extractFromTurn(turn('There is an issue with the CPT code.'), ctx()).drafts.filter(
      (d) => d.kind === 'fact' && d.category === 'denial_reason',
    );
    expect(facts.map((f) => f.kind === 'fact' && f.value)).toEqual(['procedure code']);
  });

  it('takes a bare "Smith." as the name when identity was just asked for', () => {
    expect(extractFromTurn(turn('Smith.'), ctx({ askedFor: 'rep_identity' })).identity.first).toBe('Smith');
    expect(extractFromTurn(turn("It's Smith."), ctx({ askedFor: 'rep_identity' })).identity.first).toBe('Smith');
    // Not when something else was asked: a one-word answer to a code question is not a name.
    expect(extractFromTurn(turn('Smith.'), ctx({ askedFor: 'diagnosis_code' })).identity.first).toBeNull();
  });

  it('accepts a three-digit badge, and a digits-only turn once the name is known', () => {
    const afterName = ctx({ identity: { first: 'Smith', badge: null }, askedFor: 'rep_identity' });
    const ext = extractFromTurn(turn('227.'), afterName);
    expect(ext.identity.badge).toBe('227');
    expect(ext.drafts.some((d) => d.kind === 'fact' && d.category === 'rep_identity' && d.value === 'Smith 227')).toBe(true);
  });

  it('never files a digits-only answer to the reference question as a badge', () => {
    const ext = extractFromTurn(turn('627762.'), ctx({ identity: { first: 'Smith', badge: null }, askedFor: 'reference_number' }));
    expect(ext.identity.badge).toBeNull();
  });

  it('still reads the full form "This is Smith, badge number 2267."', () => {
    const ext = extractFromTurn(turn('This is Smith, badge number 2267.'), ctx());
    expect(ext.identity).toMatchObject({ first: 'Smith', badge: '2267' });
  });
});

describe('call plan: holding for the badge and never repeating a question verbatim', () => {
  const afterGreeting = (): PlanState => ({ ...initialPlan(), moves: { greet: 1 } });
  const ledger = createLedger(BRIEF.claimId);

  it('waits, rather than moving on, when the Rep said "Badge number." and stopped', () => {
    const { move } = nextMove(afterGreeting(), BRIEF, ledger, 'call-live', [], {
      lastRepText: 'Badge number.',
      identity: { first: 'Smith', badge: null },
    });
    expect(move.kind).toBe('wait');
  });

  it('re-asks only for the missing half of the identity, and never says the Rep cut out', () => {
    const { move } = nextMove(afterGreeting(), BRIEF, ledger, 'call-live', [], {
      lastRepText: 'Smith.',
      identity: { first: 'Smith', badge: null },
    });
    expect(move.kind).toBe('identify');
    expect(move.line?.text).toBe('Thanks, Smith. And your badge number?');
    expect(askIdentityAgain({ first: null, badge: '2267' }).text).toBe('And your name, please?');
    expect(askIdentityAgain().text).not.toMatch(/cut out/);
  });

  it('the whole flow: "Smith." then "Badge number." then "227." ends with one identity row', () => {
    let session = startCall(ledger, { callId: 'call-live', capturedAt: '2026-09-29T12:57:56Z' });
    let plan = afterGreeting();
    session = noteUsLine(session, 'Could I get your name and badge number?');
    for (const said of ['Smith.', 'Badge number.', '227.']) {
      const r = ingestRepTurn(session, turn(said));
      session = r.session;
      const next = nextMove(plan, BRIEF, session.ledger, 'call-live', [], { lastRepText: said, identity: session.identity });
      plan = next.state;
      if (next.move.line) session = noteUsLine(session, next.move.line.text);
    }
    const rows = session.ledger.statements.filter((s) => s.kind === 'fact' && s.category === 'rep_identity');
    expect(rows.map((r) => r.kind === 'fact' && r.value)).toEqual(['Smith 227']);
  });

  it('asks each objective differently the second time, and the second wording still classifies the same', () => {
    for (const key of Object.keys(OBJECTIVES) as ObjectiveKey[]) {
      const first = askObjective(key, 0).text;
      const second = askObjective(key, 1).text;
      expect(second).not.toBe(first);
      expect(classifyAsk(second, false)).toBe(classifyAsk(first, false));
    }
  });

  it('asks which code after a procedure-code reason, as it does after a diagnosis one', () => {
    let session = startCall(ledger, { callId: 'call-live', capturedAt: '2026-09-29T12:57:56Z' });
    session = ingestRepTurn(session, turn('This is Smith, badge number 2267.')).session;
    session = ingestRepTurn(session, turn('It is denied. There is an issue with the CPT code.')).session;
    let plan: PlanState = { ...initialPlan(), moves: { greet: 1, verify: 1, probe_prior: 1, 'ask:remit_reason': 1 } };
    const keys: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = nextMove(plan, BRIEF, session.ledger, 'call-live', []);
      plan = next.state;
      keys.push(next.move.key);
      if (next.move.line) session = noteUsLine(session, next.move.line.text);
      if (next.move.key === 'ask:specific_code') break;
    }
    expect(keys).toContain('ask:specific_code');
  });
});
