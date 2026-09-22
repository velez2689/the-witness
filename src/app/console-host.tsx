'use client';

import { useMemo } from 'react';
import { LiveCall } from '@/services/live-call';
import { PcmPlayer, startMic } from '@/services/audio-io';
import { SessionRegistry } from '@/services/session-registry';
import { readWorkbook } from '@/services/workbook-reader';
import { createWorklistStore } from '@/services/worklist-store';
import { Console } from '@/ui/Console';
import type { ConsoleProps, LiveDriver } from '@/ui/console-types';

const MAX_SESSION_SECONDS = 300;

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/token?kind=agent', { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; detail?: string };
  if (!res.ok || !body.token) throw new Error(body.detail ?? body.error ?? `token request failed (${res.status})`);
  return body.token;
}

/** Binds the UI to the real services. The UI itself never imports services. */
export function ConsoleHost(props: ConsoleProps) {
  const worklistStore = useMemo(() => createWorklistStore(), []);
  const driver: LiveDriver = useMemo(() => {
    const registry = new SessionRegistry(MAX_SESSION_SECONDS);
    if (typeof window !== 'undefined') registry.attachToWindow(window);
    const player = new PcmPlayer();
    return {
      create: (input, events) =>
        new LiveCall({
          ...input,
          registry,
          fetchToken,
          startMic,
          playAudio: (b64) => player.enqueue(b64),
          stopAudio: () => player.stop(),
          events,
        }),
      closeAll: (reason) => {
        registry.closeAll(reason);
        player.stop();
      },
    };
  }, []);
  return <Console {...props} driver={driver} readWorkbook={readWorkbook} worklistStore={worklistStore} />;
}
