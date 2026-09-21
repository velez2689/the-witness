'use client';

import { useMemo } from 'react';
import type { ObjectiveKey } from '@/domain/call-brief';
import { canHangUp, computeGate } from '@/domain/capture-gate';
import { appendStatement, type ClaimLedger } from '@/domain/claim-ledger';
import { detect, groupByTrigger } from '@/domain/engine';
import type { FeedItem } from './call-feed';
import type { ConsoleProps } from './console-types';

/** Everything the console shows, derived from the feed of REVEALED items. Same for scripted and live. */
export function useDerived(
  feed: readonly FeedItem[],
  visible: number,
  props: ConsoleProps,
  objectives: readonly ObjectiveKey[],
  dismissed: readonly string[],
  selected: string | null,
) {
  const { historyLedger, live } = props;
  const shown = useMemo(() => feed.slice(0, visible), [feed, visible]);

  const ledger: ClaimLedger = useMemo(() => {
    let l = historyLedger;
    for (const item of shown) for (const s of item.added) l = appendStatement(l, s);
    return l;
  }, [shown, historyLedger]);

  const contradictions = useMemo(() => detect(ledger), [ledger]);
  const liveContradictions = useMemo(
    () => contradictions.filter((c) => c.statementIds[1].startsWith(`stmt-${live.id}-`)),
    [contradictions, live.id],
  );
  const groups = useMemo(() => groupByTrigger(liveContradictions), [liveContradictions]);
  const open = groups.filter((g) => !dismissed.includes(g[0].statementIds[1]));
  const banner = open[0] ?? null;
  const focus =
    (selected ? groups.find((g) => g[0].statementIds[1] === selected)?.[0] : null) ??
    banner?.[0] ??
    groups[groups.length - 1]?.[0] ??
    null;

  const gate = useMemo(() => computeGate(ledger, live.id, objectives), [ledger, live.id, objectives]);
  const holdSeconds = useMemo(() => shown.reduce((n, i) => n + i.holdSeconds, 0), [shown]);
  const lastRep = [...shown].reverse().find((i) => i.side === 'rep');
  const lastFlagged = [...shown].reverse().find((i) => i.side === 'rep' && i.contradictions.length > 0);
  const last = shown[shown.length - 1];
  const clockMs = last ? last.atMs + last.durationMs : 0;

  return {
    shown, ledger, contradictions, liveContradictions, groups, banner, openCount: open.length, focus,
    gate, hangUpOk: canHangUp(gate), holdSeconds, clockMs,
    flagLatencyMs: lastFlagged?.engineMs ?? null,
    extractMs: lastRep?.engineMs ?? null,
  };
}
