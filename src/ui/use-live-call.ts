'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectiveKey } from '@/domain/call-brief';
import { estimateDurationMs } from '@/domain/script';
import type { FeedItem } from './call-feed';
import type { ConsoleProps, LiveDriver, LiveSession } from './console-types';
import { useDerived } from './use-derived';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

/**
 * Turn a start failure into something the Agent can act on. The browser's own wording for a
 * blocked microphone ("Permission denied") does not tell anyone where to click, and in an
 * incognito window a blocked mic is the single most likely reason a call never begins.
 */
function startFailureMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const raw = e instanceof Error ? e.message : String(e);

  if (name === 'NotAllowedError' || /permission|denied|dismissed/i.test(raw)) {
    return 'Microphone blocked. Click the camera or microphone icon in the address bar, allow it for this site, then press Start again. In an incognito window Chrome asks every time.';
  }
  if (name === 'NotFoundError' || /no (audio )?(input )?device|not found/i.test(raw)) {
    return 'No microphone found. Plug in or select an input device, then press Start again.';
  }
  if (name === 'NotReadableError' || /in use|busy/i.test(raw)) {
    return 'The microphone is in use by another app. Close whatever is holding it and press Start again.';
  }
  if (/token|401|403|not_configured/i.test(raw)) {
    return `Could not get a session token from the server. ${raw}`;
  }
  return `The call could not start: ${raw}`;
}

/** "Be the Rep": the same console, fed by a live Voice Agent session instead of a script. */
export function useLiveCall(props: ConsoleProps, objectives: readonly ObjectiveKey[], driver: LiveDriver | undefined) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [latency, setLatency] = useState<{ flagMs: number; speakMs: number | null } | null>(null);
  const [drift, setDrift] = useState<string[]>([]);
  const session = useRef<LiveSession | null>(null);
  const n = useRef(0);

  const brief = useMemo(() => ({ ...props.brief, objectives }), [props.brief, objectives]);

  /**
   * The id is taken HERE, not inside the updater.
   *
   * Reading `n.current` inside the `setFeed` callback reads it whenever React chooses to run
   * that callback - which is after any other queued update has already incremented the ref,
   * and twice over in development. A Rep turn and the Witness reply that follows it therefore
   * both came out as the same key, and React is explicit that duplicate keys mean children
   * "may be duplicated and/or omitted": turns silently missing from the call timeline, on the
   * one screen whose entire job is to be a complete record of what was said.
   */
  const push = useCallback((item: Omit<FeedItem, 'id'>) => {
    n.current += 1;
    const id = `l-${n.current}`;
    setFeed((f) => [...f, { ...item, id }]);
  }, []);

  const start = useCallback(async () => {
    if (!driver) return;
    setFeed([]); setDismissed([]); setSelected(null); setLatency(null); setDrift([]); setDetail(null);
    const s = driver.create(
      { brief, ledger: props.historyLedger, call: { callId: props.live.id, capturedAt: props.live.startedAt } },
      {
        status: (st, d) => { setStatus(st); setDetail(d ?? null); },
        rep: (e) => push({ side: 'rep', text: e.text, atMs: e.atMs, durationMs: estimateDurationMs(e.text), holdSeconds: 0, cites: [], added: e.added, contradictions: e.contradictions, engineMs: e.engineMs, lowConfidence: false, tag: null }),
        witness: (e) => push({ side: 'witness', text: e.text, atMs: e.atMs, durationMs: estimateDurationMs(e.text), holdSeconds: 0, cites: e.cites, added: [], contradictions: [], engineMs: null, lowConfidence: false, tag: e.tag }),
        latency: setLatency,
        drift: (u) => setDrift((d) => [...d, ...u]),
        done: () => undefined,
      },
    );
    session.current = s;
    /*
     * start() throws for the ordinary reasons a live call fails to begin - microphone blocked,
     * no input device, the token request refused. This used to be an unguarded await called as
     * `void start()`, so every one of those became an unhandled rejection: the button did
     * nothing, said nothing, and left the console sitting in idle. "Nothing happens" is the
     * worst failure a demo can have, because there is nothing to act on.
     */
    try {
      await s.start();
    } catch (e) {
      setStatus('error');
      setDetail(startFailureMessage(e));
    }
  }, [driver, brief, props.historyLedger, props.live.id, props.live.startedAt, push]);

  const stop = useCallback(() => session.current?.stop('user-stop'), []);
  const reset = useCallback(() => {
    driver?.closeAll('reset');
    session.current = null;
    setStatus('idle'); setFeed([]); setDismissed([]); setSelected(null); setLatency(null); setDrift([]); setDetail(null);
  }, [driver]);

  useEffect(() => () => driver?.closeAll('unmount'), [driver]);

  const derived = useDerived(feed, feed.length, props, objectives, dismissed, selected);
  const dismiss = useCallback((t: string) => setDismissed((d) => (d.includes(t) ? d : [...d, t])), []);

  return {
    available: Boolean(driver), status, detail, latency, drift, feed,
    start, stop, reset, dismiss, select: setSelected, selected, brief,
    ...derived,
  };
}
