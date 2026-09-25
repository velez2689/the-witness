'use client';

import { useMemo } from 'react';
import { LiveCall } from '@/services/live-call';
import { PcmPlayer, startMic } from '@/services/audio-io';
import { CallRecorder } from '@/services/call-recorder';
import { SessionRegistry } from '@/services/session-registry';
import { readWorkbook } from '@/services/workbook-reader';
import { createWorklistStore } from '@/services/worklist-store';
import { Console } from '@/ui/Console';
import type { ConsoleProps, LiveDriver } from '@/ui/console-types';

const MAX_SESSION_SECONDS = 300;

async function fetchToken(kind: 'agent' | 'stt'): Promise<string> {
  const res = await fetch(`/api/token?kind=${kind}`, { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; detail?: string };
  if (!res.ok || !body.token) throw new Error(body.detail ?? body.error ?? `token request failed (${res.status})`);
  return body.token;
}

/** Hand a file to the operator. Nothing is uploaded; the call never leaves the machine. */
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can cancel the download in Chrome; one frame is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Binds the UI to the real services. The UI itself never imports services. */
export function ConsoleHost(props: ConsoleProps) {
  const worklistStore = useMemo(() => createWorklistStore(), []);
  const driver: LiveDriver = useMemo(() => {
    const registry = new SessionRegistry(MAX_SESSION_SECONDS);
    if (typeof window !== 'undefined') registry.attachToWindow(window);
    const player = new PcmPlayer();
    const recorder = new CallRecorder();
    player.onState = (speaking) => recorder.note(speaking ? 'playback-started' : 'playback-idle');
    return {
      create: (input, events) => {
        recorder.begin();
        return new LiveCall({
          ...input,
          registry,
          fetchToken,
          // The microphone is teed BEFORE the call gates it. rep.wav is then what the room
          // actually sounded like, which is the only way to answer "it did not hear me" - a
          // recording of what we chose to send cannot show what we chose to drop.
          startMic: (onChunk) => startMic((pcm) => { recorder.fromRep(pcm); onChunk(pcm); }),
          playAudio: (b64) => { recorder.fromWitness(b64); player.enqueue(b64); },
          stopAudio: () => player.stop(),
          isSpeaking: () => player.isSpeaking(),
          events: {
            ...events,
            status: (s, d) => { recorder.note(s === 'error' ? 'error' : 'ready', d ?? s); events.status(s, d); },
            rep: (e) => { recorder.note('rep-turn', e.text); events.rep(e); },
            witness: (e) => { recorder.note('witness-line', `${e.tag}: ${e.text}`); events.witness(e); },
            drift: (u) => { recorder.note('drift', u.join(', ')); events.drift(u); },
            done: (r) => { recorder.end(r); events.done(r); },
          },
        });
      },
      closeAll: (reason) => {
        registry.closeAll(reason);
        player.stop();
        recorder.end(reason);
      },
      saveCall: () => {
        for (const f of recorder.files()) download(f.name, f.blob);
      },
      hasRecording: () => recorder.hasAudio,
    };
  }, []);
  return <Console {...props} driver={driver} readWorkbook={readWorkbook} worklistStore={worklistStore} />;
}
