/**
 * Browser audio for the live path. Both directions are PCM16 mono at 24 kHz (Voice Agent API).
 * Chrome-only by design: AudioContext with a fixed sample rate, AudioWorklet, and setSinkId.
 */
export const SAMPLE_RATE = 24_000;
const CHUNK_SAMPLES = 1_200; // 50 ms

const WORKLET = `
class Pcm16Chunker extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK_SAMPLES}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === ${CHUNK_SAMPLES}) {
        const out = new Int16Array(${CHUNK_SAMPLES});
        for (let j = 0; j < ${CHUNK_SAMPLES}; j++) {
          const s = Math.max(-1, Math.min(1, this.buf[j]));
          out[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(out.buffer, [out.buffer]);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm16-chunker', Pcm16Chunker);
`;

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export interface Mic {
  stop(): void;
}

/** Captures the microphone with echo cancellation and streams ~50 ms PCM16 chunks (base64). */
export async function startMic(onChunk: (base64Pcm16: string) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // AssemblyAI recommend the browser path specifically for these three: hardware echo
    // cancellation is what stops the Witness's own TTS being transcribed as the Rep.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm16-chunker');
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(toBase64(new Uint8Array(e.data)));
  source.connect(node);
  return {
    stop() {
      try {
        stream.getTracks().forEach((t) => t.stop());
        node.disconnect();
        source.disconnect();
        void ctx.close();
      } catch {
        /* already stopped */
      }
    },
  };
}

/**
 * How much audio to hold before the first sample is heard, and after any under-run.
 *
 * This is the whole reason the Witness sounded like a robot rather than a person. The voice
 * arrives as ~50 ms websocket messages; the previous player gave each one its own
 * AudioBufferSourceNode scheduled 20 ms ahead of the clock. Twenty milliseconds is less than
 * the jitter on a normal connection, so the queue ran dry mid-word, over and over, and each
 * refill restarted the clock — a gap and a discontinuity inside individual syllables. The
 * rendered audio was fine; the playback was shredding it. One continuous stream with a real
 * jitter buffer is the fix.
 *
 * 120 ms is the smallest buffer that survived jitter without being audible as delay. It is
 * added to time-to-first-word, so it is deliberately small and stated honestly, not hidden.
 */
export const PREBUFFER_SECONDS = 0.12;
const RING_SECONDS = 30;

/**
 * Playback processor: one output stream fed from a ring buffer, never a schedule of clips.
 *
 * Under-run outputs silence and re-arms the pre-buffer, so a slow network costs one clean
 * pause instead of a stutter on every 128-sample render quantum. Overflow drops the incoming
 * tail rather than wrapping over audio that has not been heard yet — losing the end of a
 * sentence is recoverable, corrupting the middle of one is not.
 */
export const PLAYER_WORKLET = `
class PcmQueue extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.ring = new Float32Array(o.capacity);
    this.prebuffer = o.prebuffer;
    this.read = 0; this.write = 0; this.count = 0;
    this.draining = false; this.active = false;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.read = 0; this.write = 0; this.count = 0;
        this.draining = false; this.report(false);
        return;
      }
      const s = new Float32Array(e.data);
      const cap = this.ring.length;
      for (let i = 0; i < s.length && this.count < cap; i++) {
        this.ring[this.write] = s[i];
        this.write = (this.write + 1) % cap;
        this.count++;
      }
    };
  }
  report(on) {
    if (on === this.active) return;
    this.active = on;
    this.port.postMessage(on ? 'speaking' : 'idle');
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this.draining) {
      if (this.count < this.prebuffer) { out.fill(0); return true; }
      this.draining = true;
    }
    const cap = this.ring.length;
    const n = Math.min(out.length, this.count);
    for (let i = 0; i < n; i++) {
      out[i] = this.ring[this.read];
      this.read = (this.read + 1) % cap;
    }
    this.count -= n;
    if (n < out.length) {
      out.fill(0, n);
      this.draining = false;
      this.report(false);
    } else {
      this.report(true);
    }
    return true;
  }
}
registerProcessor('pcm-queue', PcmQueue);
`;

/**
 * Plays the agent's PCM16 chunks as one gapless stream. `stop()` flushes the queue (barge-in).
 *
 * Chunks handed over before the worklet module finishes loading are held, not dropped: the
 * first reply.audio arrives within a second of connecting, which is the same moment this
 * context is being built.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: Float32Array[] = [];
  private speaking = false;
  private lastActivity = 0;

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      void this.open(this.ctx);
    }
    return this.ctx;
  }

  private async open(ctx: AudioContext): Promise<void> {
    const url = URL.createObjectURL(new Blob([PLAYER_WORKLET], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.ctx !== ctx) return; // disposed while loading
    const node = new AudioWorkletNode(ctx, 'pcm-queue', {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: {
        capacity: Math.round(RING_SECONDS * SAMPLE_RATE),
        prebuffer: Math.round(PREBUFFER_SECONDS * SAMPLE_RATE),
      },
    });
    node.port.onmessage = (e: MessageEvent<string>) => {
      this.speaking = e.data === 'speaking';
      this.lastActivity = ctx.currentTime;
    };
    node.connect(ctx.destination);
    this.node = node;
    // A context created before any user gesture starts suspended; without this the stream is
    // built correctly and stays silent.
    if (ctx.state === 'suspended') await ctx.resume();
    const held = this.pending;
    this.pending = [];
    for (const chunk of held) this.push(chunk);
  }

  private push(samples: Float32Array): void {
    if (this.node) this.node.port.postMessage(samples.buffer, [samples.buffer]);
    else this.pending.push(samples);
  }

  /** Route output to a specific device (e.g. the Agent's earpiece in Copilot mode). Chrome only. */
  async setOutputDevice(deviceId: string): Promise<void> {
    const ctx = this.context() as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (ctx.setSinkId) await ctx.setSinkId(deviceId);
  }

  enqueue(base64Pcm16: string): void {
    const ctx = this.context();
    const bytes = fromBase64(base64Pcm16);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const samples = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) samples[i] = pcm[i] / 0x8000;
    this.lastActivity = ctx.currentTime;
    this.push(samples);
  }

  /**
   * Is the Witness audibly speaking right now?
   *
   * Used to hold the microphone closed while it talks. Browser echo cancellation is built around
   * a single capture-and-render path, and this player renders through its own AudioContext, so
   * on speakers the Witness's voice returns through the microphone, is transcribed as the Rep,
   * and the call plan answers its own questions. The tail covers the speaker and room delay,
   * and also the pre-buffer window, where audio is in hand but not yet audible.
   */
  isSpeaking(tailSeconds = 0.25): boolean {
    if (!this.ctx) return false;
    if (this.speaking) return true;
    return this.ctx.currentTime - this.lastActivity < tailSeconds;
  }

  stop(): void {
    this.pending = [];
    this.speaking = false;
    this.node?.port.postMessage('flush');
  }

  dispose(): void {
    this.stop();
    this.node?.disconnect();
    this.node = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
