import { describe, expect, it } from 'vitest';
import { PLAYER_WORKLET, PREBUFFER_SECONDS, SAMPLE_RATE, fromBase64, toBase64 } from '@/services/audio-io';

/**
 * These tests run the REAL worklet source string that ships to the browser, not a re-implementation
 * of it. There is no AudioWorklet in Node, so the two globals the processor needs are supplied and
 * the source is evaluated. Testing a copy of this algorithm would have proved nothing: the bug it
 * replaces was a playback bug, invisible to every other test in the suite, and the only symptom was
 * a voice that sounded like a robot.
 */
const QUANTUM = 128;

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void };
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

function processor(prebufferSamples = Math.round(PREBUFFER_SECONDS * SAMPLE_RATE)) {
  const sent: unknown[] = [];
  class Base {
    port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (m: unknown) => sent.push(m) };
  }
  let Cls: (new (o: { processorOptions: Record<string, number> }) => Proc) | null = null;
  new Function('AudioWorkletProcessor', 'registerProcessor', PLAYER_WORKLET)(
    Base,
    (_name: string, cls: unknown) => { Cls = cls as new (o: { processorOptions: Record<string, number> }) => Proc; },
  );
  const p = new Cls!({ processorOptions: { capacity: 4096, prebuffer: prebufferSamples } });
  return {
    sent,
    feed(samples: Float32Array) { p.port.onmessage!({ data: samples.buffer }); },
    flush() { p.port.onmessage!({ data: 'flush' }); },
    /** Render one quantum and return it. */
    render(): Float32Array {
      const out = new Float32Array(QUANTUM);
      p.process([], [[out]]);
      return out;
    },
  };
}

/** A ramp is used everywhere below so a dropped or repeated sample is visible, not just audible. */
const ramp = (n: number, from = 1) => Float32Array.from({ length: n }, (_, i) => from + i);

describe('playback worklet: the voice must come out as one continuous stream', () => {
  it('holds silence until the pre-buffer is met, then plays every sample in order', () => {
    const p = processor(256);
    p.feed(ramp(200));
    expect(Array.from(p.render())).toEqual(Array(QUANTUM).fill(0)); // 200 < 256: not yet
    p.feed(ramp(120, 201)); // now 320 buffered
    expect(Array.from(p.render())).toEqual(Array.from(ramp(QUANTUM)));
    expect(Array.from(p.render())).toEqual(Array.from(ramp(QUANTUM, 129)));
  });

  /**
   * The failure this whole class exists to prevent. Chunks arrive in bursts with gaps between
   * them; the old player scheduled each burst 20 ms ahead of the clock, so a gap longer than
   * that landed inside a word. Here the samples must come out contiguous regardless of when
   * they were handed over.
   */
  it('is gapless across chunk boundaries even when chunks arrive unevenly', () => {
    const p = processor(64);
    const played: number[] = [];
    let next = 1;
    // Feeds and renders interleave, so the queue genuinely runs low between bursts - which is
    // what a real websocket does and what the previous player could not survive.
    for (const n of [200, 13, 300, 1, 150, 90]) {
      p.feed(ramp(n, next));
      next += n;
      for (let q = 0; q < 2; q += 1) for (const v of p.render()) if (v !== 0) played.push(v);
    }
    for (let q = 0; q < 10; q += 1) for (const v of p.render()) if (v !== 0) played.push(v);
    // Strictly increasing by exactly one: no gap, no repeat, no reordering anywhere.
    for (let i = 1; i < played.length; i += 1) expect(played[i]).toBe(played[i - 1] + 1);
    // A residue smaller than the pre-buffer stays queued for the next burst, by design.
    expect(played.length).toBeGreaterThan(600);
  });

  it('an under-run costs one clean pause, not a stutter on every quantum', () => {
    const p = processor(64);
    p.feed(ramp(150));
    expect(p.render()[0]).toBe(1); // 128 played, 22 left
    const starved = p.render();
    expect(Array.from(starved.slice(0, 22))).toEqual(Array.from(ramp(22, 129)));
    expect(starved[22]).toBe(0);
    // Still short of the pre-buffer, so it waits rather than dribbling out fragments.
    p.feed(ramp(40, 151));
    expect(Array.from(p.render())).toEqual(Array(QUANTUM).fill(0));
    p.feed(ramp(40, 191));
    expect(p.render()[0]).toBe(151); // resumes exactly where it stopped
  });

  it('reports speaking and idle so the microphone can be held closed while the Witness talks', () => {
    const p = processor(64);
    p.feed(ramp(300));
    p.render();
    expect(p.sent).toEqual(['speaking']);
    p.render();
    p.render(); // drains at 384 > 300
    expect(p.sent).toEqual(['speaking', 'idle']);
  });

  it('flush drops queued audio immediately, which is what barge-in requires', () => {
    const p = processor(64);
    p.feed(ramp(2000));
    p.render();
    p.flush();
    expect(Array.from(p.render())).toEqual(Array(QUANTUM).fill(0));
    expect(p.sent).toEqual(['speaking', 'idle']);
  });

  /**
   * Overflow drops the incoming tail instead of wrapping over unheard audio. Wrapping would
   * corrupt the middle of a sentence already in the queue - and a Witness that garbles the
   * middle of a challenge is worse than one that clips the end of it.
   */
  it('never overwrites audio that has not been heard yet', () => {
    const p = processor(64);
    p.feed(ramp(4096));
    p.feed(ramp(500, 99_001));
    expect(Array.from(p.render())).toEqual(Array.from(ramp(QUANTUM)));
  });
});

describe('base64 PCM16 round trip', () => {
  it('survives a payload larger than one spread call', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 17 }, (_, i) => i % 256);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
