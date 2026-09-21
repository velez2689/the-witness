'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectiveKey } from '@/domain/call-brief';
import { estimateDurationMs } from '@/domain/script';
import type { FeedItem } from './call-feed';
import type { ConsoleProps, LiveDriver, LiveSession } from './console-types';
import { useDerived } from './use-derived';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

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

  const push = useCallback((item: Omit<FeedItem, 'id'>) => {
    n.current += 1;
    setFeed((f) => [...f, { ...item, id: `l-${n.current}` }]);
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
    await s.start();
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
