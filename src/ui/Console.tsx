'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ObjectiveKey } from '@/domain/call-brief';
import { toCallBrief } from '@/domain/claim-import';
import { buildClaimUpdate } from '@/domain/claim-update';
import { createLedger } from '@/domain/claim-ledger';
import { closeOutForAgent } from '@/domain/speech';
import { shortDate } from '@/lib/dates';
import { ClaimUpdateSheet } from './ClaimUpdateSheet';
import { ClaimImport } from './ClaimImport';
import { ClaimTimeline } from './ClaimTimeline';
import { Icon } from './Icon';
import { BriefPanel, Banner, CaptureSheet, HangUpGate, Inspector, RepCue, Transcript, TransportBar, type Source } from './Panels';
import { RosterBand } from './RosterBand';
import { Stage } from './Stage';
import { buildStats, StatStrip } from './StatStrip';
import type { ConsoleProps, LiveDriver } from './console-types';
import { useCallRunner, type Phase } from './use-call-runner';
import { useLiveCall } from './use-live-call';
import { useRoster } from './use-roster';
import { useWorklist } from './use-worklist';

const THEMES = ['auto', 'light', 'dark'] as const;

export function Console(props: ConsoleProps & { driver?: LiveDriver }) {
  const [objectives, setObjectives] = useState<readonly ObjectiveKey[]>(props.brief.objectives);
  const [source, setSource] = useState<Source>('scripted');
  const [theme, setTheme] = useState<(typeof THEMES)[number]>('auto');
  const worklist = useWorklist(props.readWorkbook, props.worklistStore);

  /**
   * Which claims the console is working: the imported worklist once the Agent has loaded it,
   * otherwise the sample claim with its six calls of history.
   *
   * An imported claim has no history on file, so no contradiction can fire on its first call —
   * that is the truth about a claim nobody has called on yet, and the timeline says so rather
   * than implying otherwise. The scripted Rep is disabled for imported claims on purpose:
   * replaying the sample conversation would file the sample rep's words into a real patient's
   * ledger, which is precisely the contamination this product exists to refuse.
   */
  const imported = worklist.loaded && worklist.chosen.length > 0;
  const active: ConsoleProps = useMemo(() => {
    if (!imported) return props;
    const [lead, ...rest] = worklist.chosen;
    return {
      ...props,
      brief: toCallBrief(lead, props.brief.providerName, objectives),
      patientLabel: lead.patientLabel || lead.claimId,
      historyLedger: createLedger(lead.claimId),
      historyCalls: [],
      batch: rest.map((c) => ({
        brief: toCallBrief(c, props.brief.providerName, objectives),
        patientLabel: c.patientLabel || c.claimId,
        lines: [], // no script for a real claim: those words have not been spoken yet
      })),
    };
  }, [imported, objectives, props, worklist.chosen]);

  const scripted = useCallRunner(active, objectives);
  const liveCall = useLiveCall(active, objectives, props.driver);
  // A real claim has no recorded conversation to replay, so Live is the only honest source.
  const isLive = imported ? true : source === 'live';

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

  const totalHistoryHold = active.historyCalls.reduce((n, c) => n + c.holdSeconds, 0);
  const callsSoFar = active.historyCalls.length + (phase === 'idle' ? 0 : 1);
  const stats = useMemo(
    () =>
      buildStats({
        calls: callsSoFar,
        holdSeconds: totalHistoryHold + v.holdSeconds,
        costPerCall: props.costPerCall,
        statements: v.ledger.statements.length,
        contradictions: v.contradictions.length,
        refusals: v.ledger.statements.filter((s) => s.kind === 'refusal').length,
      }),
    [callsSoFar, totalHistoryHold, v.holdSeconds, props.costPerCall, v.ledger.statements, v.contradictions.length],
  );
  const lastWitness = [...v.shown].reverse().find((i) => i.side === 'witness');
  const suggestion = lastWitness?.tag ? (props.bank[lastWitness.tag]?.text ?? null) : null;
  const banner = v.banner;
  const flagMs = isLive ? (liveCall.latency?.flagMs ?? v.flagLatencyMs) : v.flagLatencyMs;

  // The rest of the batch: same call, same rep, separate ledgers. Opens once the lead claim is worked.
  const roster = useRoster(
    { brief: active.brief, patientLabel: active.patientLabel, ledger: v.ledger },
    active.batch,
    { callId: props.live.id, capturedAt: props.live.startedAt },
    scripted.speed,
  );
  useEffect(() => {
    if (phase === 'idle') roster.reset();
    // Resetting the call resets the batch with it; roster.reset is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /**
   * One control that puts the console back to a known state: no imported claims, no call in
   * progress, no batch, nothing left over from the last run. Anything less leaves a screen that
   * looks ready but is still carrying the previous attempt.
   */
  const clearEverything = () => {
    worklist.clear();
    roster.reset();
    liveCall.reset();
    scripted.reset();
  };

  return (
    <div className="w-shell">
      <TransportBar
        phase={phase}
        mode={mode}
        clockMs={v.clockMs}
        holdSeconds={v.holdSeconds}
        claimId={active.brief.claimId}
        payer={active.brief.payer}
        statementCount={v.ledger.statements.length}
        flagLatencyMs={flagMs}
        extractMs={v.extractMs}
        replyMs={isLive ? (liveCall.latency?.speakMs ?? null) : null}
        live={isLive}
        theme={theme}
        onTheme={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
      />
      <StatStrip stats={stats} />
      <ClaimImport
        fileName={worklist.fileName}
        sheetName={worklist.sheetName}
        result={worklist.result}
        busy={worklist.busy}
        error={worklist.error}
        selected={worklist.selected}
        loaded={worklist.loaded}
        onPick={worklist.pick}
        onToggle={worklist.toggle}
        onLoad={worklist.load}
        onClear={clearEverything}
      />
      <BriefPanel
        brief={{ ...active.brief, objectives }}
        patientLabel={active.patientLabel}
        locked={phase !== 'idle'}
        mode={scripted.mode}
        setMode={scripted.setMode}
        source={isLive ? 'live' : source}
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
        onSaveCall={isLive ? liveCall.saveCall : undefined}
        onTakeOver={scripted.takeOver}
        canTakeOver={!isLive && scripted.mode === 'A' && phase !== 'idle' && phase !== 'done' && !scripted.tookOver}
        totalHold={totalHistoryHold + v.holdSeconds}
        callsCount={active.historyCalls.length + (phase === 'idle' ? 0 : 1)}
        costPerCall={props.costPerCall}
        imported={imported}
        onUseSample={clearEverything}
      />
      {isLive && phase === 'running' && <RepCue lastAsk={lastWitness?.text ?? null} suggestion={suggestion} />}
      <div className="w-flaglane" aria-label="Contradiction flag lane">
        {banner ? (
          <Banner group={banner} ledger={v.ledger} queued={v.openCount - 1} onDismiss={() => v.dismiss(banner[0].statementIds[1])} />
        ) : (
          <div className="w-empty">
            <p className="w-note" style={{ margin: 0 }}>
              {phase === 'idle'
                ? 'Flag lane. When the Rep contradicts something already on record, it lands here with both quotes.'
                : 'No open flag. Dismissed flags stay on the timeline.'}
            </p>
          </div>
        )}
      </div>
      <ClaimTimeline
        dateOfService={active.brief.dateOfService}
        historyCalls={active.historyCalls}
        ledger={v.ledger}
        contradictions={v.contradictions}
        focus={v.focus}
        liveStartedAt={props.live.startedAt}
        liveDuration={props.live.durationSeconds}
        liveNumber={active.historyCalls.length + 1}
        holdSeconds={v.holdSeconds}
        running={phase !== 'idle'}
        onSelectCall={v.select}
      />
      <div className="w-stage">
        <header className="w-stage-head">
          <h2>
            <Icon name="radio" size={15} />
            <span>Live call</span>
          </h2>
          <p className="w-note">
            {shortDate(props.live.startedAt)} ·{' '}
            {mode === 'A' ? 'the Witness is speaking to the Rep' : 'the Agent is speaking, the Witness whispers'}
          </p>
        </header>
        <Stage shown={v.shown} focus={v.focus} mode={mode} totalMs={isLive ? 180_000 : 150_000} />
      </div>
      <Transcript items={v.shown} mode={mode} />
      {isLive && liveCall.drift.length > 0 && (
        <p role="alert" className="w-note" style={{ margin: 0, padding: '6px 16px', color: 'var(--flag)' }}>
          Self-check: the agent spoke {liveCall.drift.join(', ')}, which is not in the record.
        </p>
      )}
      <RosterBand
        gates={roster.gates}
        items={roster.items}
        segment={roster.segment}
        segmentDone={roster.segmentDone}
        running={roster.running}
        started={roster.started}
        atLastPatient={roster.atLastPatient}
        canEnd={roster.canEnd}
        outstanding={roster.outstanding}
        openWarning={roster.openWarning}
        leadDone={finished}
        gateCount={active.batch.length + 1}
        onBegin={roster.begin}
        onNext={roster.next}
        onReset={roster.reset}
        onRelease={roster.release}
        onDiscard={roster.discard}
      />
      <div className="w-lower">
        <Inspector ledger={v.ledger} focus={v.focus} shown={v.shown} callCount={active.historyCalls.length} closeOut={closeOut} finished={finished} />
        <CaptureSheet brief={{ ...active.brief, objectives }} patientLabel={active.patientLabel} ledger={v.ledger} gate={v.gate} callId={props.live.id} />
        <HangUpGate gate={v.gate} ok={v.hangUpOk} phase={phase} batch={roster.started ? roster.outstanding : null} />
      </div>
      {update && <ClaimUpdateSheet update={update} />}
    </div>
  );
}
