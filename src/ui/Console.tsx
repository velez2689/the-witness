'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ObjectiveKey } from '@/domain/call-brief';
import { buildClaimUpdate } from '@/domain/claim-update';
import { closeOutForAgent } from '@/domain/speech';
import { ClaimUpdateSheet } from './ClaimUpdateSheet';
import { BriefPanel, Banner, CaptureSheet, HangUpGate, Inspector, RepCue, Transcript, TransportBar, type Source } from './Panels';
import { Stage } from './Stage';
import type { ConsoleProps, LiveDriver } from './console-types';
import { useCallRunner, type Phase } from './use-call-runner';
import { useLiveCall } from './use-live-call';

const THEMES = ['auto', 'light', 'dark'] as const;

export function Console(props: ConsoleProps & { driver?: LiveDriver }) {
  const [objectives, setObjectives] = useState<readonly ObjectiveKey[]>(props.brief.objectives);
  const [source, setSource] = useState<Source>('scripted');
  const [theme, setTheme] = useState<(typeof THEMES)[number]>('auto');
  const scripted = useCallRunner(props, objectives);
  const liveCall = useLiveCall(props, objectives, props.driver);
  const isLive = source === 'live';

  useEffect(() => {
    try {
      if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
    } catch {
      /* theming is a convenience */
    }
  }, [theme]);

  // One view for both sources: the panels neither know nor care where the Rep's words came from.
  const v = isLive ? liveCall : scripted;
  const phase: Phase = isLive
    ? liveCall.status === 'idle' || (liveCall.status === 'error' && liveCall.feed.length === 0)
      ? 'idle' // a failed start (no token, no mic) leaves nothing to report: back to a retryable state
      : liveCall.status === 'closed' || liveCall.status === 'error' ? 'done' : 'running'
    : scripted.phase;
  const finished = phase === 'done';
  const mode = isLive ? 'A' : scripted.mode;

  const closeOut = useMemo(
    () => (finished ? closeOutForAgent(v.ledger, props.live.id, v.liveContradictions, v.holdSeconds) : null),
    [finished, v.ledger, props.live.id, v.liveContradictions, v.holdSeconds],
  );
  const update = useMemo(
    () => (finished ? buildClaimUpdate(v.ledger, props.live.id, v.liveContradictions, v.holdSeconds) : null),
    [finished, v.ledger, props.live.id, v.liveContradictions, v.holdSeconds],
  );

  const totalHistoryHold = props.historyCalls.reduce((n, c) => n + c.holdSeconds, 0);
  const lastWitness = [...v.shown].reverse().find((i) => i.side === 'witness');
  const suggestion = lastWitness?.tag ? (props.bank[lastWitness.tag]?.text ?? null) : null;
  const banner = v.banner;
  const flagMs = isLive ? (liveCall.latency?.flagMs ?? v.flagLatencyMs) : v.flagLatencyMs;

  return (
    <div className="w-shell">
      <TransportBar
        phase={phase}
        mode={mode}
        clockMs={v.clockMs}
        holdSeconds={v.holdSeconds}
        claimId={props.brief.claimId}
        payer={props.brief.payer}
        statementCount={v.ledger.statements.length}
        flagLatencyMs={flagMs}
        extractMs={v.extractMs}
        replyMs={isLive ? (liveCall.latency?.speakMs ?? null) : null}
        live={isLive}
        theme={theme}
        onTheme={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
      />
      <BriefPanel
        brief={{ ...props.brief, objectives }}
        patientLabel={props.patientLabel}
        locked={phase !== 'idle'}
        mode={scripted.mode}
        setMode={scripted.setMode}
        source={source}
        setSource={setSource}
        liveAvailable={liveCall.available}
        liveDetail={isLive ? liveCall.detail : null}
        objectives={objectives}
        setObjectives={setObjectives}
        phase={phase}
        speed={scripted.speed}
        setSpeed={scripted.setSpeed}
        onStart={() => (isLive ? void liveCall.start() : scripted.start(scripted.mode))}
        onStop={liveCall.stop}
        onPause={scripted.pause}
        onResume={scripted.resume}
        onStep={scripted.advance}
        onReset={isLive ? liveCall.reset : scripted.reset}
        onTakeOver={scripted.takeOver}
        canTakeOver={!isLive && scripted.mode === 'A' && phase !== 'idle' && phase !== 'done' && !scripted.tookOver}
        totalHold={totalHistoryHold + v.holdSeconds}
        callsCount={props.historyCalls.length + (phase === 'idle' ? 0 : 1)}
        costPerCall={props.costPerCall}
      />
      {isLive && phase === 'running' && <RepCue lastAsk={lastWitness?.text ?? null} suggestion={suggestion} />}
      <div className="w-flaglane" aria-label="Contradiction flag lane">
        {banner ? (
          <Banner group={banner} ledger={v.ledger} queued={v.openCount - 1} onDismiss={() => v.dismiss(banner[0].statementIds[1])} />
        ) : (
          <p className="w-note" style={{ margin: 0 }}>
            {phase === 'idle'
              ? 'Flag lane. When the Rep contradicts something already on record, it lands here with both quotes.'
              : 'No open flag. Dismissed flags stay on the timeline.'}
          </p>
        )}
      </div>
      <div className="w-stage">
        <Stage
          historyCalls={props.historyCalls}
          ledger={v.ledger}
          contradictions={v.contradictions}
          shown={v.shown}
          focus={v.focus}
          liveStartedAt={props.live.startedAt}
          liveDuration={props.live.durationSeconds}
          running={phase !== 'idle'}
          mode={mode}
          totalMs={isLive ? 180_000 : 150_000}
          holdSeconds={v.holdSeconds}
        />
      </div>
      <Transcript items={v.shown} mode={mode} />
      {isLive && liveCall.drift.length > 0 && (
        <p role="alert" className="w-note" style={{ margin: 0, padding: '6px 16px', color: 'var(--flag)' }}>
          Self-check: the agent spoke {liveCall.drift.join(', ')}, which is not in the record.
        </p>
      )}
      <div className="w-lower">
        <Inspector ledger={v.ledger} focus={v.focus} shown={v.shown} callCount={props.historyCalls.length} closeOut={closeOut} finished={finished} />
        <CaptureSheet brief={{ ...props.brief, objectives }} patientLabel={props.patientLabel} ledger={v.ledger} gate={v.gate} callId={props.live.id} />
        <HangUpGate gate={v.gate} ok={v.hangUpOk} phase={phase} />
      </div>
      {update && <ClaimUpdateSheet update={update} />}
    </div>
  );
}
