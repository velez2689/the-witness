'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ObjectiveKey } from '@/domain/call-brief';
import { canHangUp, computeGate } from '@/domain/capture-gate';
import { appendStatement, type ClaimLedger } from '@/domain/claim-ledger';
import { detect, groupByTrigger } from '@/domain/engine';
import { startModeA, stepModeA, type ModeAState } from '@/domain/mode-a';
import { resumeModeB, startModeB, stepModeB, type ModeBState } from '@/domain/mode-b';
import { fromModeA, fromModeB, type FeedItem } from './call-feed';
import type { ConsoleProps } from './console-types';

export type Mode = 'A' | 'B';
export type Phase = 'idle' | 'running' | 'paused' | 'done';

const BASE_DELAY_MS = 1500;

/**
 * Drives one scripted call. NOTHING starts on load: a call begins only when the Agent presses Start
 * (the account allows 5 new streams per minute; the same rule holds for the scripted path).
 */
export function useCallRunner(props: ConsoleProps) {
  const { brief, historyLedger, live, bank } = props;
  const [mode, setMode] = useState<Mode>('A');
  const [objectives, setObjectives] = useState<readonly ObjectiveKey[]>(brief.objectives);
  const [basePhase, setPhase] = useState<Phase>('idle');
  const [speed, setSpeed] = useState(1);
  const [a, setA] = useState<ModeAState | null>(null);
  const [b, setB] = useState<ModeBState | null>(null);
  const [visible, setVisible] = useState(0);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [tookOver, setTookOver] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const activeBrief = useMemo(() => ({ ...brief, objectives }), [brief, objectives]);

  const feed: FeedItem[] = useMemo(
    () => [...(a ? fromModeA(a.events) : []), ...(b ? fromModeB(b.events) : [])],
    [a, b],
  );

  const start = useCallback(
    (m: Mode) => {
      setMode(m);
      setDismissed([]);
      setSelected(null);
      setTookOver(false);
      setVisible(0);
      setB(null);
      setA(null);
      const callMeta = { callId: live.id, capturedAt: live.startedAt, repSurname: live.repSurname };
      if (m === 'A') setA(startModeA(historyLedger, activeBrief, callMeta, bank));
      else setB(startModeB(historyLedger, activeBrief, live));
      setPhase('running');
    },
    [activeBrief, bank, historyLedger, live],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setA(null);
    setB(null);
    setVisible(0);
    setDismissed([]);
    setSelected(null);
    setTookOver(false);
  }, []);

  /** Reveal one more item, computing the next step of the call when the feed is exhausted. */
  const advance = useCallback(() => {
    if (visible < feed.length) {
      setVisible((v) => v + 1);
      return;
    }
    if (b) {
      if (!b.finished) setB(stepModeB(b));
      return;
    }
    if (a && !a.plan.done) setA(stepModeA(a).state);
  }, [a, b, feed.length, visible]);

  // Derived, not stored: the call is done once the plan/script has finished AND everything is revealed.
  const computedDone = b ? b.finished : a ? a.plan.done : false;
  const phase: Phase = basePhase === 'running' && computedDone && visible >= feed.length ? 'done' : basePhase;

  useEffect(() => {
    if (phase !== 'running') return;
    const t = setTimeout(advance, BASE_DELAY_MS / speed);
    return () => clearTimeout(t);
  }, [phase, advance, speed, visible, a, b]);

  const takeOver = useCallback(() => {
    if (!a || b) return;
    setB(resumeModeB(a, live));
    setMode('B');
    setTookOver(true);
  }, [a, b, live]);

  // The ledger the console shows: history plus only what has been REVEALED so far.
  const ledger: ClaimLedger = useMemo(() => {
    let l = historyLedger;
    for (const item of feed.slice(0, visible)) for (const s of item.added) l = appendStatement(l, s);
    return l;
  }, [feed, visible, historyLedger]);

  const shown = feed.slice(0, visible);
  const contradictions = useMemo(() => detect(ledger), [ledger]);
  const liveContradictions = useMemo(
    () => contradictions.filter((c) => c.statementIds[1].startsWith(`stmt-${live.id}-`)),
    [contradictions, live.id],
  );
  const groups = useMemo(() => groupByTrigger(liveContradictions), [liveContradictions]);
  const open = groups.filter((g) => !dismissed.includes(g[0].statementIds[1]));
  const banner = open[0] ?? null;
  const focus = (selected ? groups.find((g) => g[0].statementIds[1] === selected)?.[0] : null) ?? banner?.[0] ?? groups[groups.length - 1]?.[0] ?? null;

  const gate = useMemo(() => computeGate(ledger, live.id, objectives), [ledger, live.id, objectives]);
  const holdSeconds = useMemo(() => shown.reduce((n, i) => n + i.holdSeconds, 0), [shown]);
  const lastRep = [...shown].reverse().find((i) => i.side === 'rep');
  const lastFlagged = [...shown].reverse().find((i) => i.side === 'rep' && i.contradictions.length > 0);
  const clockMs = shown.length ? shown[shown.length - 1].atMs + shown[shown.length - 1].durationMs : 0;

  const dismiss = useCallback((trigger: string) => setDismissed((d) => (d.includes(trigger) ? d : [...d, trigger])), []);

  return {
    mode, setMode, objectives, setObjectives, phase, speed, setSpeed,
    start, reset, advance, takeOver, tookOver,
    pause: () => setPhase('paused'),
    resume: () => setPhase('running'),
    feed, shown, visible, finished: phase === 'done',
    ledger, contradictions, liveContradictions, groups, banner, openCount: open.length, focus,
    dismiss, select: setSelected, selected,
    gate, hangUpOk: canHangUp(gate), holdSeconds, clockMs,
    flagLatencyMs: lastFlagged?.engineMs ?? null, extractMs: lastRep?.engineMs ?? null,
    brief: activeBrief,
  };
}
