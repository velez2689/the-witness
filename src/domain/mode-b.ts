import type { CallBrief } from './call-brief';
import { computeGate } from './capture-gate';
import { ingestRepTurn, noteUsLine, startCall, endArchivedCall, type CallSession } from './call-session';
import type { Contradiction } from './contradiction';
import { detect, groupByTrigger } from './engine';
import type { ClaimLedger } from './claim-ledger';
import { estimateDurationMs, type ScriptCall } from './script';
import * as speech from './speech';
import type { Statement } from './statement';
import type { ModeAState } from './mode-a';

/**
 * Mode B — Copilot. The Agent speaks to the Rep; the Witness listens and WHISPERS into the Agent's
 * earpiece only. The Witness never speaks on the line. Same pipeline as Mode A: the whisper is
 * assembled from statement rows, never composed by the model.
 */
export type CopilotEvent =
  | { type: 'agent'; text: string; atMs: number }
  | {
      type: 'rep';
      text: string;
      atMs: number;
      holdBeforeSeconds: number;
      added: Statement[];
      contradictions: Contradiction[];
      engineMs: number;
    }
  | { type: 'whisper'; text: string; cites: readonly string[]; atMs: number; reason: string }
  | { type: 'closeout'; text: string; cites: readonly string[]; atMs: number };

export interface ModeBState {
  brief: CallBrief;
  script: ScriptCall;
  /** Index of the next script line. */
  cursor: number;
  session: CallSession;
  clockMs: number;
  holdSeconds: number;
  events: CopilotEvent[];
  /** Trigger statements already whispered about. */
  whispered: readonly string[];
  finished: boolean;
}

export function startModeB(ledger: ClaimLedger, brief: CallBrief, script: ScriptCall, fromIndex = 0): ModeBState {
  return {
    brief,
    script,
    cursor: fromIndex,
    session: startCall(ledger, { callId: script.id, capturedAt: script.startedAt, nameHint: script.repSurname }),
    clockMs: 0,
    holdSeconds: 0,
    events: [],
    whispered: [],
    finished: false,
  };
}

/** Replays one script line. The Agent's lines feed the read-back tracker; the Rep's feed the extractor. */
export function stepModeB(state: ModeBState): ModeBState {
  if (state.finished) return state;
  const events = [...state.events];
  const line = state.script.lines[state.cursor];

  if (!line) {
    // End of call: render the Close-Out from the record, and flag anything still missing.
    const closed = endArchivedCall(state.session);
    const all = closed.session.ledger;
    const gate = computeGate(all, state.script.id, state.brief.objectives);
    for (const item of gate.filter((g) => g.required && g.state === 'missing')) {
      const w = speech.whisperMissing(item.label);
      events.push({ type: 'whisper', text: w.text, cites: w.cites, atMs: state.clockMs, reason: `gate:${item.key}` });
    }
    const contradictions = detect(all).filter((c) => c.statementIds[1].startsWith(`stmt-${state.script.id}-`));
    const out = speech.closeOutForAgent(all, state.script.id, contradictions, state.holdSeconds);
    events.push({ type: 'closeout', text: out.text, cites: out.cites, atMs: state.clockMs });
    return { ...state, session: closed.session, events, finished: true };
  }

  const start = state.clockMs;
  const end = start + estimateDurationMs(line.text);

  if (line.who === 'US') {
    events.push({ type: 'agent', text: line.text, atMs: start });
    return { ...state, cursor: state.cursor + 1, session: noteUsLine(state.session, line.text), clockMs: end, events };
  }

  const t0 = performance.now();
  const r = ingestRepTurn(state.session, { text: line.text, startMs: start, endMs: end, lowConfidence: line.lowConfidence });
  const engineMs = performance.now() - t0;
  events.push({
    type: 'rep',
    text: line.text,
    atMs: start,
    holdBeforeSeconds: line.holdBeforeSeconds ?? 0,
    added: r.added,
    contradictions: r.contradictions,
    engineMs,
  });

  const whispered = [...state.whispered];
  for (const group of groupByTrigger(r.contradictions)) {
    const c = group[0];
    if (whispered.includes(c.statementIds[1])) continue;
    whispered.push(c.statementIds[1]);
    const w = speech.whisperFor(r.session.ledger, c);
    events.push({ type: 'whisper', text: w.text, cites: w.cites, atMs: end, reason: c.kind });
  }
  // A reference number that lands unconfirmed becomes a spoken read-back prompt for the Agent.
  const unconfirmedRef = r.added.find(
    (s) => s.kind === 'fact' && s.category === 'reference_number' && s.confidence === 'captured_unconfirmed',
  );
  if (unconfirmedRef && unconfirmedRef.kind === 'fact' && line.lowConfidence) {
    const w = speech.whisperReadback(unconfirmedRef.value);
    events.push({ type: 'whisper', text: w.text, cites: [unconfirmedRef.id], atMs: end, reason: 'readback' });
  }

  return {
    ...state,
    cursor: state.cursor + 1,
    session: r.session,
    clockMs: end,
    holdSeconds: state.holdSeconds + (line.holdBeforeSeconds ?? 0),
    events,
    whispered,
  };
}

export function runModeB(initial: ModeBState): ModeBState {
  let s = initial;
  for (let i = 0; i < 200 && !s.finished; i += 1) s = stepModeB(s);
  return s;
}

/**
 * Take Over: the Agent picks up the call mid-flight. The ledger, identity and clock carry over and the
 * Witness drops to whispering. Resumes the script after the last Rep line already heard.
 */
export function resumeModeB(a: ModeAState, script: ScriptCall): ModeBState {
  const lastRep = [...a.events].reverse().find((e) => e.type === 'rep');
  let cursor = 0;
  if (lastRep && lastRep.type === 'rep') {
    for (let i = script.lines.length - 1; i >= 0; i -= 1) {
      if (script.lines[i].who === 'REP' && script.lines[i].text === lastRep.line.text) {
        cursor = i + 1;
        break;
      }
    }
  }
  return {
    brief: a.brief,
    script,
    cursor,
    session: a.session,
    clockMs: a.clockMs,
    holdSeconds: a.holdSeconds,
    events: [],
    whispered: a.plan.challenged,
    finished: false,
  };
}
