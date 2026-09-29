import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OBJECTIVES, type CallBrief } from '@/domain/call-brief';
import { buildHistory } from '@/domain/script-runner';
import { LiveCall, RECAP_SILENCE_MS, STT_SETTINGS, keytermsFor, type LiveEvents } from '@/services/live-call';
import { SessionRegistry } from '@/services/session-registry';
import { CALLS, CLAIM, LIVE_CALL } from '@fixtures/scripts/claim-A-4471-08';
import { REP_BANK_CALL_06 } from '@fixtures/scripts/rep-bank-call-06';
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
  const log = { witness: [] as string[], tags: [] as string[], rep: [] as string[], flags: [] as string[], drift: [] as string[][], status: [] as string[], done: [] as string[], trace: [] as string[], played: 0 };
  let sttUrl = '';
  const mic = { stop: vi.fn() };
  const tokens = vi.fn(async (kind: 'agent' | 'stt') => `single-use-token-${kind}`);
  const events: LiveEvents = {
    status: (s) => log.status.push(s),
    rep: (e) => { log.rep.push(e.text); e.contradictions.forEach((c) => log.flags.push(c.kind)); },
    witness: (e) => { log.witness.push(e.text); log.tags.push(e.tag); },
    latency: () => undefined,
    drift: (u) => log.drift.push(u),
    done: (r) => log.done.push(r),
    trace: (k, d) => log.trace.push(d ? `${k}: ${d}` : k),
  };
  let stt!: FakeSocket;
  const call = new LiveCall({
    brief: BRIEF, ledger: history.ledger, call: { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt },
    registry, fetchToken: tokens, startMic: async () => mic, playAudio: () => { log.played += 1; }, stopAudio: () => undefined,
    events, makeSocket: () => (sock = new FakeSocket()), makeSttSocket: (url) => { sttUrl = url; return (stt = new FakeSocket()); },
  });
  const said = () => sock.sent.filter((m) => m.type === 'reply.create').map((m) => String(m.instructions));
  return { call, registry, sock: () => sock, stt: () => stt, sttUrl: () => sttUrl, log, mic, tokens, said };
}

/** The server plays the line we just asked for: reply.started then reply.done, both ours. */
function ourReply(h: ReturnType<typeof harness>, status = 'completed') {
  h.sock().server({ type: 'reply.started', reply_id: 'ours' });
  h.sock().server({ type: 'reply.done', reply_id: 'ours', status });
}

/** Bring both sockets up the way the browser does: voice ready, then the transcription socket. */
async function live(h: ReturnType<typeof harness>) {
  await ready(h);
  h.stt().open();
  h.stt().server({ type: 'Begin', id: 'stt-1' });
}

/** Play the Rep Simulator against the live plan until the Witness reaches `untilTag`. */
function playRep(h: ReturnType<typeof harness>, untilTag: string) {
  for (let guard = 0; guard < 30; guard += 1) {
    const tag = h.log.tags.at(-1);
    if (tag === untilTag) return;
    const line = REP_BANK_CALL_06[tag ?? ''] ?? { who: 'REP', text: 'Can you repeat that?' };
    h.stt().server({ type: 'Turn', transcript: line.text, end_of_turn: true });
    ourReply(h);
  }
  throw new Error(`never reached ${untilTag}; tags were ${h.log.tags.join(' > ')}`);
}

/**
 * Play out a Rep turn the way the server really does it.
 *
 * The server answers every finalized user turn with its own LLM before we get a word in, and
 * that reply is never played. Our assembled line is held until it finishes, so a test that
 * asserts on what the Witness said has to let the unheard turn happen first - otherwise it is
 * asserting against a protocol the server does not follow.
 */
function finishTurn(h: ReturnType<typeof harness>) {
  h.sock().server({ type: 'reply.started', reply_id: 'model' });
  h.sock().server({ type: 'reply.done', reply_id: 'model', status: 'completed' });
  h.sock().server({ type: 'reply.started', reply_id: 'ours' });
  h.sock().server({ type: 'reply.done', reply_id: 'ours', status: 'completed' });
}

async function ready(h: ReturnType<typeof harness>) {
  await h.call.start();
  h.sock().open();
  h.sock().server({ type: 'session.ready', session_id: 's1' });
  await Promise.resolve();
  await Promise.resolve();
}

describe('LiveCall: Mode A on the Voice Agent API with a person as the Rep', () => {
  /**
   * Two tokens now, one per socket, and both minted BEFORE either connects. A call that can speak
   * but cannot hear is worse than one that never started, so the failure has to surface before the
   * greeting goes out rather than halfway through the conversation.
   */
  it('does nothing until start(), then mints one token per socket', async () => {
    const h = harness();
    expect(h.tokens).not.toHaveBeenCalled();
    await ready(h);
    expect(h.tokens).toHaveBeenCalledTimes(2);
    expect(h.tokens.mock.calls.map((c) => c[0]).sort()).toEqual(['agent', 'stt']);
    expect(h.registry.openCount).toBe(2);
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
    finishTurn(h);
    h.sock().server({ type: 'transcript.user', text: 'Okay. That claim denied. Timely filing.' });
    finishTurn(h);
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

/**
 * The bug that ruined the first live test: the Witness's audio broke up, it could not hear the
 * tester, and it asked the same question over and over. All three came from its own voice
 * returning through the microphone, so these pin both halves of the fix.
 */
describe('acoustic echo: the Witness must not hear itself', () => {
  function echoHarness(audioSetup: 'headphones' | 'speakers' = 'speakers') {
    const registry = new SessionRegistry(300);
    let sock!: FakeSocket;
    const sent: string[] = [];
    const stops: number[] = [];
    let played = 0;
    let speaking = false;
    let stt!: FakeSocket;
    let onChunk: ((pcm: Int16Array) => void) | null = null;
    const call = new LiveCall({
      audioSetup,
      brief: BRIEF,
      ledger: history.ledger,
      call: { callId: LIVE_CALL.id, capturedAt: LIVE_CALL.startedAt },
      registry,
      fetchToken: async () => 'tok',
      startMic: async (cb) => { onChunk = cb; return { stop: () => undefined }; },
      playAudio: () => { played += 1; },
      stopAudio: () => stops.push(1),
      isSpeaking: () => speaking,
      events: {
        status: () => undefined, rep: () => undefined, witness: () => undefined,
        latency: () => undefined, drift: () => undefined, done: () => undefined,
      },
      makeSocket: () => (sock = new FakeSocket()),
      makeSttSocket: () => (stt = new FakeSocket()),
    });
    return {
      call,
      sock: () => sock,
      stt: () => stt,
      mic: () => onChunk?.(Int16Array.from([1, 2, 3, 4])),
      speak: (v: boolean) => { speaking = v; },
      // The Rep's audio now goes to the transcription socket as binary frames, so what counts is
      // what that socket received, not input.audio messages on the Voice Agent.
      audioSent: () => stt.sent.filter((m) => m.type === 'binary').length,
      stops: () => stops.length,
      played: () => played,
      sent,
    };
  }

  it('does not flush playback every time the server hears something', async () => {
    const h = echoHarness();
    await h.call.start();
    h.sock().open();
    h.sock().server({ type: 'session.ready', session_id: 's1' });
    h.sock().server({ type: 'input.speech.started' });
    h.sock().server({ type: 'input.speech.started' });
    // Flushing here cut the Witness off mid-sentence, heard as a call breaking up.
    expect(h.stops()).toBe(0);
  });

  it('flushes only when the server reports a real interruption', async () => {
    const h = echoHarness();
    await h.call.start();
    h.sock().open();
    h.sock().server({ type: 'session.ready', session_id: 's1' });
    h.sock().server({ type: 'reply.started', reply_id: 'greet' });
    h.sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    expect(h.stops()).toBe(0);

    // The model's own unheard turn being cut short must NOT flush our playback: nothing of ours
    // was playing, and flushing on it would clip the line we are about to speak.
    h.sock().server({ type: 'transcript.user', text: 'Okay. That claim denied. Timely filing.' });
    h.sock().server({ type: 'reply.started', reply_id: 'model' });
    h.sock().server({ type: 'reply.done', reply_id: 'model', status: 'interrupted' });
    expect(h.stops()).toBe(0);

    // Ours being cut short does: that is a real barge-in by the Rep.
    h.sock().server({ type: 'reply.started', reply_id: 'ours' });
    h.sock().server({ type: 'reply.done', reply_id: 'ours', status: 'interrupted' });
    expect(h.stops()).toBe(1);
  });

  it('on speakers, holds the microphone closed while the Witness is speaking', async () => {
    const h = echoHarness('speakers');
    await h.call.start();
    h.sock().open();
    h.sock().server({ type: 'session.ready', session_id: 's1' });
    await Promise.resolve();
    await Promise.resolve();

    h.stt().open();
    h.stt().server({ type: 'Begin', id: 'stt-1' });
    const before = h.audioSent();
    h.speak(true);
    h.mic();
    h.mic();
    expect(h.audioSent(), 'the Witness would be transcribing itself').toBe(before);

    h.speak(false);
    h.mic();
    expect(h.audioSent()).toBe(before + 1);
  });

  /**
   * On headphones nothing comes back through the microphone, so gating only loses the Rep's
   * first words when they answer before the Witness has finished, which the tester heard as the
   * Witness asking the same question twice. The operator says which they are using; the code
   * cannot tell.
   */
  it('on headphones, keeps the microphone open while the Witness is speaking', async () => {
    const h = echoHarness('headphones');
    await h.call.start();
    h.sock().open();
    h.sock().server({ type: 'session.ready', session_id: 's1' });
    await Promise.resolve();
    await Promise.resolve();
    h.stt().open();
    h.stt().server({ type: 'Begin', id: 'stt-1' });
    const before = h.audioSent();
    h.speak(true);
    h.mic();
    expect(h.audioSent()).toBe(before + 1);
  });

  /**
   * There is no client event that cancels a reply, and the server never interrupts itself on a
   * socket it hears nothing on, so a barge-in has to mute the rest of the reply here. Flushing
   * the player alone dropped a fraction of a second and the sentence carried on.
   */
  it('a real interruption mutes the rest of the reply, and the next line still plays', async () => {
    const h = echoHarness('headphones');
    await h.call.start();
    h.sock().open();
    h.sock().server({ type: 'session.ready', session_id: 's1' });
    await Promise.resolve();
    await Promise.resolve();
    h.stt().open();
    h.stt().server({ type: 'Begin', id: 'stt-1' });
    h.sock().server({ type: 'reply.started', reply_id: 'greet' });
    h.sock().server({ type: 'reply.audio', data: 'AAAA' });
    expect(h.played()).toBe(1);

    h.speak(true);
    h.stt().server({ type: 'Turn', transcript: 'hold on a second', end_of_turn: false });
    expect(h.stops()).toBe(1);
    h.sock().server({ type: 'reply.audio', data: 'AAAA' });
    expect(h.played(), 'the rest of the interrupted reply must not reach the speaker').toBe(1);
    h.sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    h.speak(false);

    h.stt().server({ type: 'Turn', transcript: 'Darnell.', end_of_turn: true });
    h.sock().server({ type: 'reply.started', reply_id: 'identify' });
    h.sock().server({ type: 'reply.audio', data: 'AAAA' });
    expect(h.played()).toBe(2);
  });

  /**
   * Barge-in moved to us with the split. The transcription socket cannot interrupt anything - it
   * is not the one speaking - so a partial transcript while the Witness is talking is now what
   * stops playback. It must be a partial with words in it: reacting to every noise is what made
   * the Witness cut off its own sentences the first time round.
   */
  it('stops speaking when the Rep starts talking, but not for a stray noise', async () => {
    const h = echoHarness();
    await h.call.start();
    h.sock().open();
    h.sock().server({ type: 'session.ready', session_id: 's1' });
    await Promise.resolve();
    await Promise.resolve();
    h.stt().open();
    h.stt().server({ type: 'Begin', id: 'stt-1' });

    h.speak(true);
    h.stt().server({ type: 'Turn', transcript: 'a', end_of_turn: false });
    h.stt().server({ type: 'Turn', transcript: 'uh-huh', end_of_turn: false });
    expect(h.stops(), 'a single word is a cough, a back-channel, or our own echo').toBe(0);
    h.stt().server({ type: 'Turn', transcript: 'hold on a second', end_of_turn: false });
    expect(h.stops()).toBe(1);

    // Silence from the Witness means there is nothing to interrupt.
    h.speak(false);
    h.stt().server({ type: 'Turn', transcript: 'it was denied', end_of_turn: false });
    expect(h.stops()).toBe(1);
  });

  it('a finalized Turn from the transcription socket drives the call', async () => {
    const h = harness();
    await ready(h);
    h.stt().open();
    h.stt().server({ type: 'Begin', id: 'stt-1' });
    h.stt().server({ type: 'Turn', transcript: 'This is Darnell, badge two-two-one-zero.', end_of_turn: true });
    expect(h.log.rep).toContain('This is Darnell, badge two-two-one-zero.');
  });

  it('closes BOTH sockets on every exit path: each is billed while it stays open', async () => {
    const h = harness();
    await ready(h);
    h.stt().open();
    h.stt().server({ type: 'Begin', id: 'stt-1' });
    expect(h.registry.openCount).toBe(2);
    h.call.stop('user-stop');
    expect(h.stt().sent.at(-1)).toEqual({ type: 'Terminate' });
    expect(h.sock().sent.at(-1)).toEqual({ type: 'session.end' });
    expect(h.registry.openCount).toBe(0);
    expect(h.registry.balanced).toBe(true);
  });
});

describe('the whole plan on the live path', () => {
  it('configures the transcription socket for identifiers read with a pause', async () => {
    const h = harness();
    await live(h);
    const url = new URL(h.sttUrl());
    expect(url.searchParams.get('speech_model')).toBe(STT_SETTINGS.speechModel);
    expect(url.searchParams.get('max_turn_silence')).toBe(String(STT_SETTINGS.maxTurnSilenceMs));
    expect(url.searchParams.get('min_turn_silence')).toBe(String(STT_SETTINGS.minTurnSilenceMs));
    expect(url.searchParams.get('inactivity_timeout')).toBe(String(STT_SETTINGS.inactivityTimeoutSeconds));
    expect(JSON.parse(url.searchParams.get('keyterms_prompt') ?? '[]')).toContain('8K2J-702');
  });

  /**
   * The recap asks a question. It used to end the call the moment it finished playing, so the Rep
   * was hung up on mid-answer and the sign-off written for the close move was never heard live.
   */
  it('does not hang up on the recap; it signs off after the Rep answers, then ends both sockets', async () => {
    const h = harness();
    await live(h);
    playRep(h, 'recap');
    ourReply(h);
    expect(h.sock().sent.some((m) => m.type === 'session.end'), 'recap must not end the call').toBe(false);
    expect(h.registry.openCount).toBe(2);

    h.stt().server({ type: 'Turn', transcript: "You're welcome. Goodbye.", end_of_turn: true });
    expect(h.log.tags.at(-1)).toBe('close');
    expect(h.said().at(-1)).toContain('have a good one');
    ourReply(h);
    expect(h.sock().sent.at(-1)).toEqual({ type: 'session.end' });
    expect(h.stt().sent.at(-1)).toEqual({ type: 'Terminate' });
    expect(h.registry.openCount).toBe(0);
    expect(h.log.done).toEqual(['plan-complete']);
  });

  it('signs off on its own if the Rep says nothing after the recap', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await live(h);
      playRep(h, 'recap');
      ourReply(h);
      vi.advanceTimersByTime(RECAP_SILENCE_MS - 1);
      expect(h.log.tags.at(-1)).toBe('recap');
      vi.advanceTimersByTime(2);
      expect(h.log.tags.at(-1)).toBe('close');
      ourReply(h);
      expect(h.registry.openCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records socket-level events so a saved call can name its own failure', async () => {
    const h = harness();
    await live(h);
    h.sock().server({ type: 'reply.started', reply_id: 'greet' });
    h.sock().server({ type: 'transcript.agent', text: 'Hi, this is an AI assistant.' });
    h.sock().server({ type: 'reply.done', reply_id: 'greet', status: 'completed' });
    h.stt().server({ type: 'Turn', transcript: 'this is', end_of_turn: false });
    h.sock().server({ type: 'session.error', message: 'rate limited' });
    expect(h.log.trace).toEqual(expect.arrayContaining([
      'stt-begin: stt-1',
      'reply-started: ours',
      'transcript-agent: Hi, this is an AI assistant.',
      'reply-done: ours completed',
      'stt-partial: this is',
      'session-error: rate limited',
    ]));
    h.call.stop('user-stop');
    expect(h.log.trace).toEqual(expect.arrayContaining(['socket-closed: stt user-stop', 'socket-closed: voice user-stop']));
  });
});
