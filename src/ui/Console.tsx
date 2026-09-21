'use client';

import { useEffect, useMemo, useState } from 'react';
import { closeOutForAgent } from '@/domain/speech';
import { BriefPanel, Banner, CaptureSheet, HangUpGate, Inspector, Transcript, TransportBar } from './Panels';
import { Stage } from './Stage';
import type { ConsoleProps } from './console-types';
import { useCallRunner } from './use-call-runner';

const THEMES = ['auto', 'light', 'dark'] as const;

export function Console(props: ConsoleProps) {
  const r = useCallRunner(props);
  const [theme, setTheme] = useState<(typeof THEMES)[number]>('auto');

  useEffect(() => {
    try {
      if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
    } catch {
      /* theming is a convenience */
    }
  }, [theme]);

  const totalHistoryHold = props.historyCalls.reduce((n, c) => n + c.holdSeconds, 0);
  const liveContradictions = r.liveContradictions;
  const closeOut = useMemo(() => {
    if (!r.finished) return null;
    return closeOutForAgent(r.ledger, props.live.id, liveContradictions, r.holdSeconds);
  }, [r.phase, r.visible, r.finished, r.shown, r.ledger, props.live.id, liveContradictions, r.holdSeconds]);

  const banner = r.banner;
  const totalMs = r.mode === 'A' ? 120_000 : 130_000;
  const statementCount = r.ledger.statements.length;

  return (
    <div className="w-shell">
      <TransportBar
        phase={r.phase}
        mode={r.mode}
        clockMs={r.clockMs}
        holdSeconds={r.holdSeconds}
        claimId={props.brief.claimId}
        payer={props.brief.payer}
        statementCount={statementCount}
        flagLatencyMs={r.flagLatencyMs}
        extractMs={r.extractMs}
        theme={theme}
        onTheme={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
      />
      <BriefPanel
        brief={r.brief}
        patientLabel={props.patientLabel}
        locked={r.phase !== 'idle'}
        mode={r.mode}
        setMode={r.setMode}
        objectives={r.objectives}
        setObjectives={r.setObjectives}
        phase={r.phase}
        speed={r.speed}
        setSpeed={r.setSpeed}
        onStart={() => r.start(r.mode)}
        onPause={r.pause}
        onResume={r.resume}
        onStep={r.advance}
        onReset={r.reset}
        onTakeOver={r.takeOver}
        canTakeOver={r.mode === 'A' && r.phase !== 'idle' && r.phase !== 'done' && !r.tookOver}
        totalHold={totalHistoryHold + r.holdSeconds}
        callsCount={props.historyCalls.length + (r.phase === 'idle' ? 0 : 1)}
        costPerCall={props.costPerCall}
      />
      <div className="w-flaglane" aria-label="Contradiction flag lane">
        {banner ? (
          <Banner
            group={banner}
            ledger={r.ledger}
            queued={r.openCount - 1}
            onDismiss={() => r.dismiss(banner[0].statementIds[1])}
          />
        ) : (
          <p className="w-note" style={{ margin: 0 }}>
            {r.phase === 'idle'
              ? 'Flag lane. When the Rep contradicts something already on record, it lands here in under two seconds, with both quotes.'
              : 'No open flag. Dismissed flags stay on the timeline.'}
          </p>
        )}
      </div>
      <div className="w-stage">
        <Stage
          historyCalls={props.historyCalls}
          ledger={r.ledger}
          contradictions={r.contradictions}
          shown={r.shown}
          focus={r.focus}
          liveStartedAt={props.live.startedAt}
          liveDuration={props.live.durationSeconds}
          running={r.phase === 'running' || r.phase === 'paused' || r.phase === 'done'}
          mode={r.mode}
          totalMs={totalMs}
          holdSeconds={r.holdSeconds}
        />
      </div>
      <Transcript items={r.shown} mode={r.mode} />
      <div className="w-lower">
        <Inspector
          ledger={r.ledger}
          focus={r.focus}
          shown={r.shown}
          callCount={props.historyCalls.length}
          closeOut={closeOut}
          finished={r.finished}
        />
        <CaptureSheet brief={r.brief} patientLabel={props.patientLabel} ledger={r.ledger} gate={r.gate} callId={props.live.id} />
        <HangUpGate gate={r.gate} ok={r.hangUpOk} phase={r.phase} />
      </div>
    </div>
  );
}
