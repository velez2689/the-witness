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
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
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

/** Plays the agent's PCM16 chunks back-to-back. `stop()` flushes the queue (barge-in). */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    return this.ctx;
  }

  /** Route output to a specific device (e.g. the Agent's earpiece in Copilot mode). Chrome only. */
  async setOutputDevice(deviceId: string): Promise<void> {
    const ctx = this.context() as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (ctx.setSinkId) await ctx.setSinkId(deviceId);
  }

  enqueue(base64Pcm16: string): void {
    const ctx = this.context();
    const bytes = fromBase64(base64Pcm16);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) ch[i] = samples[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    this.next = Math.max(this.next, ctx.currentTime + 0.02);
    src.start(this.next);
    this.next += buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources.clear();
    this.next = 0;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
