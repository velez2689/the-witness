import { fromBase64 } from './audio-io';

/**
 * Capture a live call from inside the browser, so reviewing one never needs a screen recorder.
 *
 * A screen recorder is the wrong instrument twice over. It contends for the sound card - one
 * tester's capture delayed the greeting by eighty-one seconds, a fault that existed only while
 * recording - and it mixes both speakers into a single track that arrives after every stage of
 * the pipeline, so it can show that the audio broke up but never where.
 *
 * This sits at the two ends instead. The Witness's audio is captured as it arrives from the
 * server and the Rep's as it leaves the microphone, each to its own file, alongside a timeline of
 * when every chunk turned up and when playback actually ran. Continuous arrivals with a stalled
 * player is a buffering fault in our code; gaps in the arrivals themselves is the network or the
 * server. Nothing outside the browser can tell those apart.
 *
 * Nothing is uploaded. The files are built in memory and handed to the operator to save.
 */
export const RECORDER_SAMPLE_RATE = 24_000;

/** Stop before a runaway call can exhaust the tab. 10 minutes per channel. */
const MAX_SAMPLES = RECORDER_SAMPLE_RATE * 600;

export type CallEventKind =
  | 'start' | 'ready' | 'greeting' | 'rep-turn' | 'witness-line' | 'suppressed'
  | 'playback-started' | 'playback-idle' | 'reply-done' | 'interrupted' | 'drift'
  | 'error' | 'stop';

export interface CallEvent {
  /** Milliseconds since the call started. */
  atMs: number;
  kind: CallEventKind;
  detail?: string;
}

interface Channel {
  chunks: Int16Array[];
  samples: number;
}

const channel = (): Channel => ({ chunks: [], samples: 0 });

export class CallRecorder {
  private witness = channel();
  private rep = channel();
  private events: CallEvent[] = [];
  private startedAt: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get active(): boolean {
    return this.startedAt !== null;
  }

  /** True once there is something worth saving. */
  get hasAudio(): boolean {
    return this.witness.samples > 0 || this.rep.samples > 0;
  }

  get witnessSeconds(): number {
    return this.witness.samples / RECORDER_SAMPLE_RATE;
  }

  get repSeconds(): number {
    return this.rep.samples / RECORDER_SAMPLE_RATE;
  }

  begin(): void {
    this.witness = channel();
    this.rep = channel();
    this.events = [];
    this.startedAt = this.now();
    this.note('start');
  }

  note(kind: CallEventKind, detail?: string): void {
    if (this.startedAt === null) return;
    this.events.push({ atMs: Math.round(this.now() - this.startedAt), kind, detail });
  }

  /** Base64 PCM16 from the server, recorded at the moment it arrived. */
  fromWitness(base64: string): void {
    this.append(this.witness, base64);
  }

  /** Base64 PCM16 from the microphone, recorded as it was sent. */
  fromRep(base64: string): void {
    this.append(this.rep, base64);
  }

  private append(ch: Channel, base64: string): void {
    if (this.startedAt === null || ch.samples >= MAX_SAMPLES) return;
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(base64);
    } catch {
      return; // a malformed chunk must never take the call down
    }
    // Copy rather than view the decoded buffer: byteOffset is not guaranteed to be even, and an
    // odd offset makes the Int16Array constructor throw.
    const pcm = new Int16Array(Math.floor(bytes.byteLength / 2));
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) << 16 >> 16;
    if (!pcm.length) return;
    ch.chunks.push(pcm);
    ch.samples += pcm.length;
  }

  end(reason: string): void {
    this.note('stop', reason);
    this.startedAt = null;
  }

  /** The saved artifacts: one WAV per speaker plus the timeline that explains them. */
  files(stamp = new Date()): Array<{ name: string; blob: Blob }> {
    const tag = stamp.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out: Array<{ name: string; blob: Blob }> = [];
    if (this.witness.samples) out.push({ name: `witness-${tag}.wav`, blob: wav(this.witness) });
    if (this.rep.samples) out.push({ name: `rep-${tag}.wav`, blob: wav(this.rep) });
    out.push({
      name: `call-${tag}.json`,
      blob: new Blob(
        [JSON.stringify({
          sampleRate: RECORDER_SAMPLE_RATE,
          witnessSeconds: Number(this.witnessSeconds.toFixed(2)),
          repSeconds: Number(this.repSeconds.toFixed(2)),
          events: this.events,
        }, null, 2)],
        { type: 'application/json' },
      ),
    });
    return out;
  }
}

/** Minimal PCM16 mono WAV. No dependency, and nothing else in the repo needs a container format. */
export function wav(ch: { chunks: Int16Array[]; samples: number }): Blob {
  const dataBytes = ch.samples * 2;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RECORDER_SAMPLE_RATE, true);
  v.setUint32(28, RECORDER_SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  return new Blob([header, ...ch.chunks.map((c) => c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength))], {
    type: 'audio/wav',
  });
}
