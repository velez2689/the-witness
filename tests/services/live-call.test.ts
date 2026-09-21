import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { buildHistory } from '@/domain/script-runner';
import { LiveCall, keytermsFor, type LiveEvents } from '@/services/live-call';
import { SessionRegistry } from '@/services/session-registry';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';
import { FakeSocket } from '../helpers/fake-socket';

const BRIEF: CallBrief = {
  claimId: CLAIM.id, payer: CLAIM.payer, providerName: 'Harbor Orthopedic Billing', patientLabel: CLAIM.patient,
  memberId: CLAIM.memberId, dateOfService: CLAIM.dateOfService, dxCodes: CLAIM.dxCodes, billed: CLAIM.billed,
  objectives: DEFAULT_OBJECTIVES,
};
const history = buildHistory(CLAIM.id, CALLS);

function harness() {
  const registry = new SessionRegistry(300);
  let sock!: FakeSocket;
  const log = { witness: [] as string[], rep: [] as string[], flags: [] as string[], drift: [] as string[][], status: [] as string[], done: [] as string[] };
  const mic = { stop: vi.fn() };
  const tokens = vi.fn(async () => 'single-use-token');
  const events: LiveEvents = {
    status: (s) => log.status.push(s),
    rep: (e) => { log.rep.push(e.text); e.contradictions.forEach((c) => log.flags.push(c.kind)); },
    witness: (e) => log.witness.push(e.text),
    latency: () => undefined,
    drift: (u) => log.drift.push(u),
    done: (r) => log.done.push(r),
  };
  const call = new LiveCall({
    brief: BRIEF, ledger: history.ledger, call: { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt },
    registry, fetchToken: tokens, startMic: async () => mic, playAudio: () => undefined, stopAudio: () => undefined,
    events, makeSocket: () => (sock = new FakeSocket()),
  });
  const said = () => sock.sent.filter((m) => m.type === 'reply.create').map((m) => String(m.instructions));
  return { call, registry, sock: () => sock, log, mic, tokens, said };
}

async function ready(h: ReturnType<typeof harness>) {
  await h.call.start();
  h.sock().open();
  h.sock().server({ type: 'session.ready', session_id: 's1' });
  await Promise.resolve();
  await Promise.resolve();
}

describe('LiveCall: Mode A on the Voice Agent API with a person as the Rep', () => {
  it('does nothing until start(), then mints exactly one token', async () => {
    const h = harness();
    expect(h.tokens).not.toHaveBeenCalled();
    await ready(h);
    expect(h.tokens).toHaveBeenCalledTimes(1);
    expect(h.registry.openCount).toBe(1);
  });

  it('seeds keyterms from the claim, the ledger references and the known badges', () => {
    const terms = keytermsFor(BRIEF, history.ledger);
    for (const t of ['A-4471-08', 'MD77140228', '8K2J-702', '2210', 'Meridian Health Plan']) expect(terms).toContain(t);
  });

  it('speaks the verbatim AI + recording disclosure as the session greeting, not via reply.create', async () => {
    const h = harness();
    await ready(h);
    const update = h.sock().sent[0] as { session: { greeting: string } };
    expect(update.session.greeting).toMatch(/AI assistant/);
    expect(update.session.greeting).toMatch(/recorded/);
    expect(h.said()).toEqual([]);
    expect(h.log.status).toContain('live');
  });

  it('challenges the same-badge conflict from the plan, quoting the prior call, when the Rep repeats a reason', async () => {
    const h = harness();
    await ready(h);
    h.sock().server({ type: 'transcript.user', text: 'Meridian claims, this is Darnell, badge two-two-one-zero.' });
    h.sock().server({ type: 'transcript.user', text: 'Okay. That claim denied. Timely filing.' });
    expect(h.log.flags).toContain('value_conflict');
    const spoken = h.said();
    expect(spoken.at(-1)).toContain('Say exactly the following and nothing else:');
    expect(spoken.at(-1)).toContain('July eighth');
    expect(spoken.at(-1)).toContain('no prior authorization');
  });

  it('a stop from any exit path sends session.end, stops the mic, and balances the registry', async () => {
    const h = harness();
    await ready(h);
    h.call.stop('user-stop');
    expect(h.sock().sent.at(-1)).toEqual({ type: 'session.end' });
    expect(h.mic.stop).toHaveBeenCalled();
    expect(h.registry.balanced).toBe(true);
    expect(h.log.done).toEqual(['user-stop']);
  });

  it('page exit closes the live session through the registry', async () => {
    const h = harness();
    await ready(h);
    h.registry.closeAll('page-exit');
    expect(h.registry.openCount).toBe(0);
    expect(h.log.done).toEqual(['page-exit']);
  });

  it('a token failure is reported and no socket is opened', async () => {
    const registry = new SessionRegistry(300);
    const status: string[] = [];
    const call = new LiveCall({
      brief: BRIEF, ledger: history.ledger, call: { callId: 'call-06', capturedAt: LIVE_CALL.startedAt }, registry,
      fetchToken: async () => { throw new Error('not_configured'); }, startMic: async () => ({ stop() {} }),
      playAudio: () => undefined, stopAudio: () => undefined,
      events: { status: (s, d) => status.push(`${s}:${d ?? ''}`), rep: () => undefined, witness: () => undefined, latency: () => undefined, drift: () => undefined, done: () => undefined },
      makeSocket: () => { throw new Error('should not connect'); },
    });
    await call.start();
    expect(status).toContain('error:not_configured');
    expect(registry.openCount).toBe(0);
  });

  it('flags an agent transcript that contains a reference number not in the record', async () => {
    const h = harness();
    await ready(h);
    h.sock().server({ type: 'transcript.agent', text: 'The reference is eight K two J four four four.' });
    expect(h.log.drift[0]).toEqual(['8K2J-444']);
  });
});
