import type { CallBrief, ObjectiveKey } from '@/domain/call-brief';
import { OBJECTIVES } from '@/domain/call-brief';
import type { GateItem } from '@/domain/capture-gate';
import type { ClaimLedger } from '@/domain/claim-ledger';
import type { Contradiction } from '@/domain/contradiction';
import { callReference } from '@/domain/speech';
import type { FactStatement, Statement } from '@/domain/statement';
import { shortDate } from '@/lib/dates';
import { clockLabel, holdLabel, type FeedItem } from './call-feed';
import { Icon, type IconName } from './Icon';
import { speak } from './speak';
import type { Mode, Phase } from './use-call-runner';

const KIND_LABEL: Record<Contradiction['kind'], string> = {
  value_conflict: 'VALUE CONFLICT',
  existence_denial: 'EXISTENCE DENIAL',
  status_flip: 'STATUS FLIP',
  commitment_violation: 'COMMITMENT VIOLATION',
  policy_inconsistency: 'POLICY INCONSISTENCY',
};

function quoteOf(s: Statement): string {
  return s.span.quote;
}
function metaOf(ledger: ClaimLedger, s: Statement): string {
  const ref = callReference(ledger, s.callId);
  const who = s.speaker ? `${s.speaker.name} · badge ${s.speaker.badge}` : 'rep not identified';
  return `${shortDate(s.capturedAt)} · ${who}${ref ? ` · ref ${ref.value}` : ''}`;
}

// ---------------------------------------------------------------- transport (band 1)
export function TransportBar(p: {
  phase: Phase;
  mode: Mode;
  clockMs: number;
  holdSeconds: number;
  claimId: string;
  payer: string;
  statementCount: number;
  flagLatencyMs: number | null;
  extractMs: number | null;
  replyMs: number | null;
  live: boolean;
  theme: 'auto' | 'light' | 'dark';
  onTheme: () => void;
}) {
  const state =
    p.phase === 'idle' ? 'SYSTEM READY · NO SESSION' : p.phase === 'done' ? 'CALL CLOSED' : p.phase === 'paused' ? 'PAUSED' : `REC · ${p.mode === 'A' ? 'WITNESS SPEAKS' : 'COPILOT'}`;
  return (
    <header className="w-transport">
      <span className="w-brand">The Witness</span>
      <span className="w-time" aria-label="call clock">{clockLabel(p.clockMs)}</span>
      <span className="w-state" style={{ color: p.phase === 'running' ? 'var(--flag)' : 'var(--ink-soft)' }}>{state}</span>
      <span className="w-stat">claim <b>{p.claimId}</b> · {p.payer}</span>
      <span className="w-stat">on hold <b>{holdLabel(p.holdSeconds)}</b></span>
      <span className="w-stat">flag <b>{p.flagLatencyMs === null ? '—' : `${p.flagLatencyMs.toFixed(1)} ms`}</b> <span title="Time to extract, diff and plan for the last flagged turn, measured in the browser.">{p.live ? 'engine' : 'scripted · no network'}</span></span>
      {p.live && <span className="w-stat">first audio <b>{p.replyMs === null ? '—' : `${Math.round(p.replyMs)} ms`}</b> <span title="From the end of the Rep's turn to the first audible syllable of the Witness.">after Rep turn</span></span>}
      <span className="w-stat">extract <b>{p.extractMs === null ? '—' : `${p.extractMs.toFixed(1)} ms`}</b></span>
      <span className="w-stat">statements <b>{p.statementCount}</b></span>
      <span className="w-spacer" />
      <button className="w-btn" onClick={p.onTheme} aria-label="Toggle colour theme">theme: {p.theme}</button>
    </header>
  );
}

// ---------------------------------------------------------------- call brief (intake)
export type Source = 'scripted' | 'live';

export function BriefPanel(p: {
  brief: CallBrief;
  patientLabel: string;
  locked: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  source: Source;
  setSource: (s: Source) => void;
  liveAvailable: boolean;
  liveDetail: string | null;
  objectives: readonly ObjectiveKey[];
  setObjectives: (o: readonly ObjectiveKey[]) => void;
  phase: Phase;
  speed: number;
  setSpeed: (n: number) => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onStep: () => void;
  onReset: () => void;
  onTakeOver: () => void;
  canTakeOver: boolean;
  totalHold: number;
  callsCount: number;
  costPerCall: number;
  /** True when the console is working claims the Agent imported, not the sample. */
  imported: boolean;
  /** Drop every imported claim and go back to the sample claim with its call history. */
  onUseSample: () => void;
}) {
  const toggle = (k: ObjectiveKey) =>
    p.setObjectives(p.objectives.includes(k) ? p.objectives.filter((x) => x !== k) : [...p.objectives, k]);
  const live = p.source === 'live';
  return (
    <section className="w-brief" aria-label="Call brief">
      <div>
        <h2>
          <Icon name="list" size={15} />
          <span>{p.imported ? 'Call brief · from your worklist' : 'Call brief · sample claim, all data synthetic'}</span>
          {/*
            Sits next to the heading that states which dataset is live, because that is where
            someone looks when they are unsure. The clear control used to live only in the import
            panel further up the page, which is the wrong place to put the way out of a state you
            did not realise you were in.
          */}
          {p.imported && (
            <button type="button" className="w-btn w-back-sample" onClick={p.onUseSample}>
              <Icon name="arrowRight" size={14} />
              Back to sample claim
            </button>
          )}
        </h2>
        <dl>
          <dt>Claim</dt><dd className="id">{p.brief.claimId} · {p.patientLabel}</dd>
          <dt>Payer</dt><dd>{p.brief.payer}</dd>
          <dt>Member ID</dt><dd className="id">{p.brief.memberId}</dd>
          <dt>Date of service</dt><dd className="id">{p.brief.dateOfService}</dd>
          <dt>Diagnosis codes</dt><dd className="id">{p.brief.dxCodes.join('  ')}</dd>
        </dl>
      </div>
      <div>
        <h2><Icon name="check" size={15} /><span>What I need from this call</span></h2>
        <ul className="w-obj">
          {(Object.keys(OBJECTIVES) as ObjectiveKey[]).map((k) => (
            <li key={k}>
              <label className="w-check">
                <input type="checkbox" disabled={p.locked} checked={p.objectives.includes(k)} onChange={() => toggle(k)} />
                <span className="w-check-box" aria-hidden="true" />
                <span>{OBJECTIVES[k].label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className="w-seg" role="group" aria-label="Where the Rep comes from">
            <button aria-pressed={!live} disabled={p.locked || p.imported} title={p.imported ? 'The scripted Rep replays the sample conversation. Playing it against a real claim would file the sample rep’s words into this patient’s ledger.' : undefined} onClick={() => p.setSource('scripted')}>Scripted Rep</button>
            <button aria-pressed={live} disabled={p.locked || !p.liveAvailable} onClick={() => p.setSource('live')}>Be the Rep (live)</button>
          </span>
          {!live && (
            <span className="w-seg" role="group" aria-label="Who speaks to the Rep">
              <button aria-pressed={p.mode === 'A'} disabled={p.locked} onClick={() => p.setMode('A')}>Witness speaks</button>
              <button aria-pressed={p.mode === 'B'} disabled={p.locked} onClick={() => p.setMode('B')}>Copilot: I speak</button>
            </span>
          )}
          {p.phase === 'idle' && (
            <button className="w-btn primary" onClick={p.onStart}>
              <Icon name={live ? 'mic' : 'play'} size={15} />
              {live ? 'Start live call' : 'Start call'}
            </button>
          )}
          {live && p.phase === 'running' && <button className="w-btn warn" onClick={p.onStop}>End call</button>}
          {!live && p.phase === 'running' && <button className="w-btn" onClick={p.onPause}>Pause</button>}
          {!live && p.phase === 'paused' && <button className="w-btn primary" onClick={p.onResume}>Resume</button>}
          {!live && (p.phase === 'running' || p.phase === 'paused') && <button className="w-btn" onClick={p.onStep}>Step</button>}
          {!live && p.canTakeOver && (
            <button className="w-btn warn" onClick={p.onTakeOver}>
              <Icon name="alert" size={15} />
              Take over
            </button>
          )}
          {p.phase !== 'idle' && <button className="w-btn" onClick={p.onReset}>Reset</button>}
          {!live && (
            <span className="w-seg" role="group" aria-label="Playback speed">
              {[1, 2, 4].map((n) => (
                <button key={n} aria-pressed={p.speed === n} onClick={() => p.setSpeed(n)}>{n}x</button>
              ))}
            </span>
          )}
        </div>
        <p className="w-note" style={{ margin: '8px 0 0' }}>
          {live
            ? 'Live: you speak as the payer rep into your microphone; the Witness (AssemblyAI Voice Agent) calls you. Use headphones. Opens one AssemblyAI session only when you press Start.'
            : 'Scripted path: no microphone, no network, no session opens until you press Start.'}
        </p>
        {p.liveDetail && <p role="alert" style={{ margin: '6px 0 0', color: 'var(--flag)' }}>{p.liveDetail}</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- rep cue card (Be the Rep)
export function RepCue({ lastAsk, suggestion }: { lastAsk: string | null; suggestion: string | null }) {
  return (
    <section className="w-cue" aria-label="Rep cue card">
      <span className="w-note">You are the payer rep. </span>
      {lastAsk ? <span>The Witness just said: <b>{lastAsk}</b></span> : <span>Wait for the Witness to greet you.</span>}
      {suggestion && (
        <div style={{ marginTop: 4 }}>
          <span className="w-note">Try saying: </span>
          <span className="said">{suggestion}</span>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- banner
export function Banner(p: { group: Contradiction[]; ledger: ClaimLedger; queued: number; onDismiss: () => void }) {
  const c = p.group[0];
  const earlier = p.ledger.statements.find((s) => s.id === c.statementIds[0])!;
  const later = p.ledger.statements.find((s) => s.id === c.statementIds[1])!;
  return (
    <div className="w-banner" role="alert" aria-live="assertive">
      <div className="kind">{KIND_LABEL[c.kind]}{c.sameBadge ? ' · SAME BADGE' : ''} · {c.daysApart} DAYS APART</div>
      <div>
        <p style={{ margin: '4px 0' }}><span className="said">{quoteOf(later)}</span></p>
        <p className="w-note" style={{ margin: 0 }}>now · {later.speaker ? `${later.speaker.name} · badge ${later.speaker.badge}` : 'rep'}</p>
      </div>
      <div>
        <p style={{ margin: '4px 0' }}><span className="said">{quoteOf(earlier)}</span></p>
        <p className="w-note" style={{ margin: 0 }}>{metaOf(p.ledger, earlier)}</p>
      </div>
      <div className="row">
        <button className="w-btn" onClick={p.onDismiss}>Dismiss</button>
        {p.queued > 0 && <span className="w-note">{p.queued} more waiting</span>}
        {p.group.length > 1 && <span className="w-note">also contradicts {p.group.length - 1} earlier statement{p.group.length > 2 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- transcript
export function Transcript({ items, mode }: { items: readonly FeedItem[]; mode: Mode }) {
  const recent = items.slice(-8);
  return (
    <section className="w-transcript" aria-label="Live transcript" aria-live="polite">
      {recent.length === 0 && <span className="w-note">Nothing yet. Press Start call.</span>}
      {recent.map((i) => (
        <div key={i.id} className={`w-line ${i.side}`}>
          <span className="who">
            {i.side === 'rep' ? 'Rep' : i.side === 'witness' ? 'Witness' : i.side === 'agent' ? 'Agent' : i.side === 'whisper' ? 'Witness' : 'Close-out'}
          </span>
          <span className="txt">
            {i.side === 'rep' ? <span className="said">{i.text}</span> : i.text}
            {i.lowConfidence && <span className="w-note"> · degraded audio, unconfirmed until read back</span>}
            {i.side === 'witness' && mode === 'A' && i.cites.length > 0 && <span className="w-note"> · cites {i.cites.length} recorded statement{i.cites.length > 1 ? 's' : ''}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- inspector (5a)
export function Inspector(p: {
  ledger: ClaimLedger;
  focus: Contradiction | null;
  shown: readonly FeedItem[];
  callCount: number;
  closeOut: { text: string; cites: readonly string[] } | null;
  finished: boolean;
}) {
  const f = p.focus;
  if (!f) {
    return (
      <section className="w-panel" aria-label="Contradiction inspector">
        <h2><Icon name="alert" size={15} /><span>Contradiction inspector</span></h2>
        <p>No contradictions on this call yet. The ledger holds <b className="id">{p.ledger.statements.length}</b> statements from {p.callCount} calls, each with the words the rep said and a timestamp.</p>
      </section>
    );
  }
  const earlier = p.ledger.statements.find((s) => s.id === f.statementIds[0])!;
  const later = p.ledger.statements.find((s) => s.id === f.statementIds[1])!;
  const said = [...p.shown].reverse().find((i) => (i.side === 'witness' && i.tag === `challenge:${f.kind}`) || (i.side === 'whisper' && i.tag === f.kind));
  const related = f.relatedStatementIds.map((id) => p.ledger.statements.find((s) => s.id === id)).filter(Boolean) as Statement[];
  return (
    <section className="w-panel" aria-label="Contradiction inspector">
      <h2>Contradiction inspector</h2>
      <div className="w-kindlabel">{KIND_LABEL[f.kind]}{f.sameBadge ? ' · SAME BADGE' : ''}</div>
      <div className="w-quote">
        <span className="said">{quoteOf(later)}</span>
        <button className="w-play" onClick={() => speak(quoteOf(later))} aria-label="Play this quote"><Icon name="play" size={11} />Play</button>
        <div className="meta">just now · {later.speaker ? `${later.speaker.name} · badge ${later.speaker.badge}` : 'rep'}</div>
      </div>
      <div className="w-quote">
        <span className="said">{quoteOf(earlier)}</span>
        <button className="w-play" onClick={() => speak(quoteOf(earlier))} aria-label="Play the earlier quote"><Icon name="play" size={11} />Play</button>
        <div className="meta">{metaOf(p.ledger, earlier)}</div>
      </div>
      {related.map((r) => (
        <div className="w-quote" key={r.id}>
          <span className="said">{quoteOf(r)}</span>
          <div className="meta">also on record · {metaOf(p.ledger, r)}</div>
        </div>
      ))}
      {said && (
        <p style={{ marginTop: 10 }}>
          <span className="w-note">{said.side === 'witness' ? 'The Witness said to the Rep' : 'Whispered to the Agent'} (assembled from the {said.cites.length} rows above, not composed by the model):</span>
          <br />
          {said.text}
          {said.side === 'witness' && <button className="w-play" onClick={() => speak(said.text, 'witness')} aria-label="Play what the Witness said"><Icon name="play" size={11} />Play</button>}
        </p>
      )}
      {p.closeOut && (
        <div className="w-closeout">
          <h2>Close-out · rendered from the statement rows</h2>
          <p style={{ margin: 0 }}>{p.closeOut.text}</p>
          <button className="w-play" style={{ margin: '6px 0 0' }} onClick={() => speak(p.closeOut!.text, 'witness')}><Icon name="play" size={11} />Play close-out</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- capture sheet (5b): a CMS-1500 inset
export function CaptureSheet(p: { brief: CallBrief; patientLabel: string; ledger: ClaimLedger; gate: GateItem[]; callId: string }) {
  const reason = [...p.ledger.statements].reverse().find(
    (s): s is FactStatement => s.callId === p.callId && s.kind === 'fact' && s.category === 'denial_reason' && !s.additional,
  );
  const ref = p.gate.find((g) => g.key === 'reference_number')!;
  const priorAuth = [...p.ledger.statements].reverse().find(
    (s): s is FactStatement => s.kind === 'fact' && s.category === 'denial_reason' && s.value === 'no prior authorization',
  );
  const box = (n: string, label: string, value: string | null, state: 'ok' | 'missing' | 'unconfirmed' = 'ok', note?: string) => (
    <div className={`w-box ${state === 'ok' ? '' : state}`}>
      <span className="n">{n}</span>
      <span className="lbl">{label}</span>
      <span className="val">{value ?? (state === 'missing' ? 'NOT CAPTURED' : '')}{note && <span style={{ color: '#6b5d55', fontSize: 11 }}> {note}</span>}</span>
    </div>
  );
  return (
    <section className="w-panel" aria-label="Capture sheet">
      <h2><Icon name="file" size={15} /><span>Capture sheet</span></h2>
      <div className="w-paper">
        <div className="hdr">HEALTH INSURANCE CLAIM FORM · capture copy</div>
        {box('1a', "INSURED'S I.D. NUMBER", p.brief.memberId)}
        {box('2', "PATIENT'S NAME", p.patientLabel)}
        {box('21', 'DIAGNOSIS OR NATURE OF ILLNESS (A–C)', p.brief.dxCodes.join('  '))}
        {box('22', 'RESUBMISSION CODE / ORIGINAL REF. NO.', ref.value, ref.state === 'missing' || ref.state === 'refused' ? 'missing' : ref.state === 'unconfirmed' ? 'unconfirmed' : 'ok', ref.state === 'unconfirmed' ? '· verify' : ref.state === 'confirmed' ? '· read back' : undefined)}
        {box('23', 'PRIOR AUTHORIZATION NUMBER', priorAuth ? `payer said none on file` : null, priorAuth ? 'ok' : 'missing', priorAuth ? `· ${shortDate(priorAuth.capturedAt)}, ${priorAuth.speaker?.name ?? 'rep'}` : undefined)}
        {reason && <div className="w-stamp">DENIED · {reason.value.toUpperCase()}</div>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- hang-up gate (5c)
const STATE_WORD: Record<GateItem['state'], string> = {
  confirmed: 'confirmed',
  unconfirmed: 'unconfirmed · ask them to repeat it',
  missing: 'NOT CAPTURED',
  refused: 'refused · recorded',
};
const STATE_ICON: Record<GateItem['state'], IconName> = {
  confirmed: 'check',
  unconfirmed: 'pending',
  missing: 'x',
  refused: 'ban',
};

export function HangUpGate({
  gate,
  ok,
  phase,
  batch,
}: {
  gate: GateItem[];
  ok: boolean;
  phase: Phase;
  /** Other patients on this call still short a required field. Null when the batch has not opened. */
  batch?: readonly { patientLabel: string }[] | null;
}) {
  const missing = gate.filter((g) => g.required && g.state === 'missing');
  // The gate is per patient, but hang-up is per CALL: one short patient holds the whole line.
  const others = (batch ?? []).filter((_, i) => i > 0);
  return (
    <section className="w-panel w-gate" aria-label="Before you hang up">
      <h2>
        <Icon name="shield" size={15} />
        <span>Before you hang up</span>
      </h2>
      <ul>
        {gate.map((g) => (
          <li key={g.key}>
            <span className={`mark ${phase === 'idle' ? 'idle' : g.state}`} aria-hidden="true">
              {phase === 'idle' ? <Icon name="pending" size={15} /> : <Icon name={STATE_ICON[g.state]} size={15} />}
            </span>
            <span>
              {g.label}{g.required ? '' : ' (asked)'}
              <br />
              <span className={phase === 'idle' ? '' : g.state} style={{ fontSize: 12 }}>{g.value ? <span className="id">{g.value} · </span> : null}{phase === 'idle' ? 'waiting for the call' : STATE_WORD[g.state]}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className={`verdict ${ok ? 'ok' : 'open'}`}>
        {phase === 'idle'
          ? 'Gate opens when the call starts.'
          : !ok
            ? `Do not hang up: ${missing.map((m) => m.label.toLowerCase()).join(', ')} not captured.`
            : others.length > 0
              ? `This patient is clear, but ${others.map((o) => o.patientLabel).join(', ')} on this call ${others.length === 1 ? 'is' : 'are'} still short.`
              : 'Gate clear: every required field is captured or a refusal is on record.'}
      </div>
    </section>
  );
}
