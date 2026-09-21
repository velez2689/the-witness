'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ObjectiveKey } from '@/domain/call-brief';
import { startModeA, stepModeA, type ModeAState } from '@/domain/mode-a';
import { resumeModeB, startModeB, stepModeB, type ModeBState } from '@/domain/mode-b';
import { fromModeA, fromModeB, type FeedItem } from './call-feed';
import type { ConsoleProps } from './console-types';
import { useDerived } from './use-derived';

export type Mode = 'A' | 'B';
export type Phase = 'idle' | 'running' | 'paused' | 'done';

const BASE_DELAY_MS = 1500;

/**
 * Drives one SCRIPTED call. NOTHING starts on load: a call begins only when the Agent presses Start
 * (the account allows 5 new streams per minute; the same rule holds for the scripted path).
 */
export function useCallRunner(props: ConsoleProps, objectives: readonly ObjectiveKey[]) {
  const { brief, historyLedger, live, bank } = props;
  const [mode, setMode] = useState<Mode>('A');
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

  const derived = useDerived(feed, visible, props, objectives, dismissed, selected);
  const dismiss = useCallback((trigger: string) => setDismissed((d) => (d.includes(trigger) ? d : [...d, trigger])), []);

  return {
    mode, setMode, phase, speed, setSpeed,
    start, reset, advance, takeOver, tookOver,
    pause: () => setPhase('paused'),
    resume: () => setPhase('running'),
    feed, visible, finished: phase === 'done',
    dismiss, select: setSelected, selected,
    brief: activeBrief,
    ...derived,
  };
}
