import { describe, expect, it } from 'vitest';
import { CallRecorder } from '@/services/call-recorder';
import { crc32, zipStored } from '@/services/zip-writer';

describe('CallRecorder', () => {
  it('keeps socket-level events in the timeline, with their detail', () => {
    let t = 1000;
    const r = new CallRecorder(() => t);
    r.begin();
    t = 1500;
    r.note('reply-started', 'ours');
    t = 2200;
    r.note('reply-done', 'ours completed');
    r.note('token', 'stt ok');
    r.end('user-stop');
    const json = r.files().find((f) => f.name.startsWith('call-'))!;
    return json.blob.text().then((txt) => {
      const d = JSON.parse(txt) as { events: Array<{ atMs: number; kind: string; detail?: string }> };
      expect(d.events).toEqual(expect.arrayContaining([
        { atMs: 500, kind: 'reply-started', detail: 'ours' },
        { atMs: 1200, kind: 'reply-done', detail: 'ours completed' },
        { atMs: 1200, kind: 'token', detail: 'stt ok' },
      ]));
    });
  });
});

describe('zipStored', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('abc'))).toBe(0x352441c2);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes every entry, stored, with a central directory a reader can walk', async () => {
    const blob = await zipStored([
      { name: 'call.json', blob: new Blob(['{"a":1}']) },
      { name: 'rep.wav', blob: new Blob([new Uint8Array([1, 2, 3, 4])]) },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const eocd = bytes.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
    let p = v.getUint32(eocd + 16, true);
    const names: string[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      expect(v.getUint32(p, true)).toBe(0x02014b50);
      expect(v.getUint16(p + 10, true), 'stored, not deflated').toBe(0);
      const n = v.getUint16(p + 28, true);
      sizes.push(v.getUint32(p + 24, true));
      names.push(new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + n)));
      p += 46 + n;
    }
    expect(names).toEqual(['call.json', 'rep.wav']);
    expect(sizes).toEqual([7, 4]);
  });
});

describe('the recording behind a statement', () => {
  it('slices the Rep audio on the transcription clock, from where the socket started hearing', () => {
    const r = new CallRecorder(() => 0);
    r.begin();
    r.fromRep(Int16Array.from({ length: 24_000 }, () => 1)); // one second before the socket was ready
    r.markSttStart();
    r.fromRep(Int16Array.from({ length: 24_000 }, (_, i) => (i < 12_000 ? 100 : 30_000)));
    const slice = r.repSlice(250, 750);
    expect(slice.length).toBe(12_000);
    expect(slice[0]).toBe(100);
    expect(slice[slice.length - 1]).toBe(30_000);
    expect(r.repSlice(5_000, 6_000).length, 'nothing recorded there').toBe(0);
    const peaks = r.repPeaks(0, 1000, 4)!;
    expect(peaks.length).toBe(4);
    expect(peaks[0]).toBeCloseTo(100 / 32768, 5);
    expect(peaks[3]).toBeCloseTo(30_000 / 32768, 3);
    expect(r.repPeaks(9_000, 9_500, 4)).toBeNull();
  });
});
