'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CallBrief } from '@/domain/call-brief';
import {
  activeEntry,
  canEndCall,
  ingestToActive,
  noteUsLineOnActive,
  outstanding,
  rosterGates,
  startRoster,
  switchTo,
  type CallRoster,
  type WrongClaimWarning,
} from '@/domain/call-roster';
import { createLedger, type ClaimLedger } from '@/domain/claim-ledger';
import type { RosterPatient } from '@fixtures/scripts/roster-batch';

/**
 * Runs the "while I have you" segment of ONE call across several patients.
 *
 * It is the same pipeline the main call uses — the roster just decides which ledger a turn lands
 * in, and it only ever lands in the one the Agent explicitly selected.
 */

const STEP_MS = 1600;

export interface RosterLineItem {
  key: string;
  side: 'rep' | 'us';
  text: string;
  claimId: string;
  patientLabel: string;
  addedCount: number;
  warning: WrongClaimWarning | null;
}

export function useRoster(
  lead: { brief: CallBrief; patientLabel: string; ledger: ClaimLedger },
  batch: readonly RosterPatient[],
  call: { callId: string; capturedAt: string },
  speed: number,
) {
  const [roster, setRoster] = useState<CallRoster | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [items, setItems] = useState<RosterLineItem[]>([]);
  const [clockMs, setClockMs] = useState(0);

  // Which segment is playing: index into `batch`, or -1 while still on the lead patient.
  const segment = roster ? roster.activeIndex - 1 : -1;
  const lines = useMemo(() => (segment >= 0 ? batch[segment].lines : []), [batch, segment]);
  const segmentDone = segment >= 0 && step >= lines.length;
  // Derived, never stored: a segment plays until its lines run out. Storing it would need an
  // effect to turn it off, and that is a cascading render.
  const running = playing && !segmentDone;

  const begin = useCallback(() => {
    const started = startRoster(
      [
        { brief: lead.brief, patientLabel: lead.patientLabel, ledger: lead.ledger },
        ...batch.map((p) => ({ brief: p.brief, patientLabel: p.patientLabel, ledger: createLedger(p.brief.claimId) })),
      ],
      call,
    );
    setRoster(switchTo(started, batch[0].brief.claimId));
    setStep(0);
    setItems([]);
    setClockMs(0);
    setPlaying(true);
  }, [batch, call, lead]);

  const reset = useCallback(() => {
    setRoster(null);
    setStep(0);
    setItems([]);
    setClockMs(0);
    setPlaying(false);
  }, []);

  /** Play one line of the active segment into the ACTIVE patient's ledger. */
  const advance = useCallback(() => {
    if (!roster || segment < 0 || step >= lines.length) return;
    const line = lines[step];
    const entry = activeEntry(roster);
    const at = clockMs + (line.holdBeforeSeconds ?? 0) * 1000;
    if (line.who === 'US') {
      setRoster(noteUsLineOnActive(roster, line.text));
      setItems((x) => [
        ...x,
        { key: `${entry.brief.claimId}-${step}`, side: 'us', text: line.text, claimId: entry.brief.claimId, patientLabel: entry.patientLabel, addedCount: 0, warning: null },
      ]);
    } else {
      const result = ingestToActive(roster, { text: line.text, startMs: at, endMs: at + 2400 });
      setRoster(result.roster);
      setItems((x) => [
        ...x,
        { key: `${entry.brief.claimId}-${step}`, side: 'rep', text: line.text, claimId: entry.brief.claimId, patientLabel: entry.patientLabel, addedCount: result.added.length, warning: result.wrongClaim },
      ]);
    }
    setClockMs(at + 2400);
    setStep((s) => s + 1);
  }, [clockMs, lines, roster, segment, step]);

  /** Explicit move to the next patient. Never automatic — that is the whole rule. */
  const next = useCallback(() => {
    if (!roster || segment + 1 >= batch.length) return;
    setRoster(switchTo(roster, batch[segment + 1].brief.claimId));
    setStep(0);
    setPlaying(true);
  }, [batch, roster, segment]);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(advance, STEP_MS / Math.max(speed, 0.25));
    return () => clearTimeout(t);
  }, [running, advance, speed]);

  const gates = useMemo(() => (roster ? rosterGates(roster) : []), [roster]);
  const short = useMemo(() => (roster ? outstanding(roster) : []), [roster]);
  /**
   * The challenge stays on screen after it is answered — it happened, and the Agent should see it
   * in the record — but it stops shouting once the rep has re-stated something about the right
   * patient. A permanently loud banner would imply an open problem that is no longer open.
   */
  const openWarning = useMemo(() => {
    let at = -1;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].warning) {
        at = i;
        break;
      }
    }
    if (at < 0) return null;
    const resolved = items.slice(at + 1).some((i) => i.side === 'rep' && i.addedCount > 0 && !i.warning);
    return { warning: items[at].warning!, resolved };
  }, [items]);

  return {
    roster,
    started: roster !== null,
    gates,
    outstanding: short,
    canEnd: roster ? canEndCall(roster) : false,
    items,
    segment,
    segmentDone,
    running,
    atLastPatient: segment + 1 >= batch.length,
    openWarning,
    begin,
    next,
    reset,
    advance,
    pause: () => setPlaying(false),
    resume: () => setPlaying(true),
  };
}
