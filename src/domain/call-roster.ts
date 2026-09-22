import type { CallBrief } from './call-brief';
import { computeGate, canHangUp, type GateItem } from './capture-gate';
import { ingestRepTurn, knownReps, noteUsLine, startCall, type CallSession } from './call-session';
import type { ClaimLedger } from './claim-ledger';
import type { Contradiction } from './contradiction';
import { extractFromTurn, type RepTurn } from './extractor';
import type { ClaimId, FactStatement, Statement } from './statement';
import { findAlnumRuns } from '@/lib/alphanumeric';

/**
 * One call, several patients.
 *
 * A biller does not hang up after one claim — getting through the IVR and the hold queue
 * costs 25 minutes, so they say "while I have you, I have three more." That is where the
 * worst error in this job happens: call three's reference number filed under patient two.
 * It is invisible when it happens and nobody catches it later.
 *
 * The rule that prevents it: THE ACTIVE PATIENT IS EXPLICIT, NEVER INFERRED. A spoken member
 * ID is only ever used to CHALLENGE the operator ("you are on patient 1, the rep just read
 * patient 2's ID"). It never silently re-routes a statement, because a silent re-route would
 * manufacture exactly the contamination this product claims to prevent.
 *
 * Each patient keeps its own CallSession and its own append-only ledger. They share one
 * callId, so every statement already carries both `callId` and `claimId` and routes correctly
 * with no change to the statement, the engine or the gate.
 */

export interface RosterEntry {
  brief: CallBrief;
  patientLabel: string;
  session: CallSession;
  /** Set once the operator has moved on and the gate was satisfied (or refusals recorded). */
  closed: boolean;
}

export interface CallRoster {
  callId: string;
  capturedAt: string;
  entries: readonly RosterEntry[];
  activeIndex: number;
  /** Shared statement counter so ids stay unique across the claims on one call. */
  seq: number;
  /** Turns held back because the rep was reading another patient's chart. Never silently dropped. */
  quarantine: readonly QuarantinedTurn[];
}

/**
 * A rep turn that named another patient on this call, held out of every ledger until the Agent
 * says where it belongs.
 *
 * Withholding is not the same as discarding. The rep said something real; we simply do not know
 * which patient it describes, and guessing in either direction is the failure mode this module
 * exists to prevent. So the turn waits, in full, with what it would produce shown to the Agent.
 */
export interface QuarantinedTurn {
  id: string;
  turn: RepTurn;
  warning: WrongClaimWarning;
  /**
   * What this turn CONTAINS, for the Agent to rule on. Deliberately not `Statement[]`: these rows
   * were never appended to anything, and typing them as statements would invite treating them as
   * record. It also deliberately skips duplicate-suppression — a turn repeating something already
   * on file still says it, and an Agent shown "nothing here" would discard a turn that is in fact
   * a second, corroborating utterance.
   */
  contains: readonly WithheldItem[];
}

export interface WithheldItem {
  kind: 'fact' | 'refusal';
  category: string;
  value: string | null;
}

export interface RosterIngest {
  roster: CallRoster;
  added: Statement[];
  contradictions: Contradiction[];
  /** Set when the rep spoke a member ID belonging to a different patient on this call. */
  wrongClaim: WrongClaimWarning | null;
  /** The held turn created by this ingest, when one was. Awaiting the Agent's decision. */
  quarantined: QuarantinedTurn | null;
}

export interface WrongClaimWarning {
  spoken: string;
  expectedClaimId: ClaimId;
  spokenClaimId: ClaimId;
  spokenPatient: string;
}

export function startRoster(
  input: readonly { brief: CallBrief; patientLabel: string; ledger: ClaimLedger }[],
  call: { callId: string; capturedAt: string; nameHint?: string | null },
): CallRoster {
  if (input.length === 0) throw new Error('a call needs at least one patient on the roster');
  const memberIds = input.map((e) => e.brief.memberId);
  return {
    callId: call.callId,
    capturedAt: call.capturedAt,
    activeIndex: 0,
    seq: 0,
    quarantine: [],
    entries: input.map((e) => ({
      brief: e.brief,
      patientLabel: e.patientLabel,
      closed: false,
      session: startCall(e.ledger, {
        callId: call.callId,
        capturedAt: call.capturedAt,
        nameHint: call.nameHint ?? null,
        memberIds,
      }),
    })),
  };
}

export const activeEntry = (r: CallRoster): RosterEntry => r.entries[r.activeIndex];

const normalise = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Every member ID on this call, so the extractor never mistakes one for a reference number. */
export function memberIdsOn(r: CallRoster): string[] {
  return r.entries.map((e) => e.brief.memberId);
}

/**
 * Did the rep just read a member ID that belongs to a different patient on this call?
 * Detection only — the caller decides what to do, and nothing is re-routed.
 */
export function checkWrongClaim(r: CallRoster, turn: RepTurn): WrongClaimWarning | null {
  const active = activeEntry(r);
  const spokenRuns = findAlnumRuns(turn.text, 6).map((x) => normalise(x.raw));
  for (const other of r.entries) {
    if (other.brief.claimId === active.brief.claimId) continue;
    const id = normalise(other.brief.memberId);
    if (spokenRuns.includes(id)) {
      return {
        spoken: other.brief.memberId,
        expectedClaimId: active.brief.claimId,
        spokenClaimId: other.brief.claimId,
        spokenPatient: other.patientLabel,
      };
    }
  }
  return null;
}

/**
 * Feed a finalized Rep turn to the ACTIVE patient only.
 *
 * A turn in which the rep reads ANOTHER patient's member ID goes to quarantine rather than to a
 * ledger. The rep is reading the wrong chart, so we cannot know which patient any part of that
 * turn describes: filing it to the patient on screen would record something false about a real
 * person, and routing it to the patient they named would be the silent re-route this module
 * refuses. Either guess is the failure this product claims to prevent.
 *
 * What we do NOT do is throw it away. The turn is held whole, the Agent is shown the challenge
 * and what the turn would record, and they decide — file it to the patient the rep was reading,
 * or discard it because the rep simply misspoke. See releaseQuarantineTo / discardQuarantine.
 */
export function ingestToActive(r: CallRoster, turn: RepTurn): RosterIngest {
  const entry = activeEntry(r);
  const wrongClaim = checkWrongClaim(r, turn);
  if (wrongClaim) {
    const held: QuarantinedTurn = {
      id: `q-${r.callId}-${r.quarantine.length + 1}`,
      turn,
      warning: wrongClaim,
      contains: contentsOf(r, wrongClaim.spokenClaimId, turn),
    };
    return {
      roster: { ...r, quarantine: [...r.quarantine, held] },
      added: [],
      contradictions: [],
      wrongClaim,
      quarantined: held,
    };
  }
  // The shared counter keeps statement ids unique across the claims sharing this callId.
  const primed: CallSession = { ...entry.session, seq: r.seq };
  const result = ingestRepTurn(primed, turn);
  const entries = r.entries.map((e, i) => (i === r.activeIndex ? { ...e, session: result.session } : e));
  return {
    roster: { ...r, entries, seq: result.session.seq },
    added: result.added,
    contradictions: result.contradictions,
    wrongClaim: null,
    quarantined: null,
  };
}

/**
 * What the turn holds, read in the context of the patient the rep was actually looking at.
 * The extractor runs directly rather than through ingestRepTurn so that nothing is appended and
 * nothing is suppressed as a duplicate — the Agent rules on what was said, not on what is new.
 */
function contentsOf(r: CallRoster, claimId: ClaimId, turn: RepTurn): WithheldItem[] {
  const target = r.entries.find((e) => e.brief.claimId === claimId);
  if (!target) return [];
  const s = target.session;
  const ext = extractFromTurn(turn, {
    capturedAt: s.capturedAt,
    identity: s.identity,
    askedFor: s.askedFor,
    knownReps: knownReps(s.ledger),
    nameHint: s.nameHint,
    knownMemberIds: s.memberIds,
  });
  return ext.drafts.map((d) => ({
    kind: d.kind,
    category: d.category,
    value: d.kind === 'fact' ? d.value : null,
  }));
}

/**
 * The Agent's explicit decision: this held turn belongs to `claimId`. Nothing reaches a ledger
 * any other way. Extraction runs against that claim for real — with its own member IDs and its
 * own prior rows — so a released turn is indistinguishable from one captured while it was active.
 */
export function releaseQuarantineTo(r: CallRoster, quarantineId: string, claimId: ClaimId): RosterIngest {
  const held = r.quarantine.find((q) => q.id === quarantineId);
  const index = r.entries.findIndex((e) => e.brief.claimId === claimId);
  if (!held) throw new Error(`nothing held under ${quarantineId}`);
  if (index < 0) throw new Error(`claim ${claimId} is not on this call`);
  const target = r.entries[index];
  const result = ingestRepTurn({ ...target.session, seq: r.seq }, held.turn);
  const entries = r.entries.map((e, i) => (i === index ? { ...e, session: result.session } : e));
  return {
    roster: {
      ...r,
      entries,
      seq: result.session.seq,
      quarantine: r.quarantine.filter((q) => q.id !== quarantineId),
    },
    added: result.added,
    contradictions: result.contradictions,
    wrongClaim: null,
    quarantined: null,
  };
}

/** The Agent's other explicit decision: the rep misspoke and this turn records nothing. */
export function discardQuarantine(r: CallRoster, quarantineId: string): CallRoster {
  return { ...r, quarantine: r.quarantine.filter((q) => q.id !== quarantineId) };
}

/** Held turns the Agent has not yet ruled on. The call should not close over an unresolved one. */
export const pendingQuarantine = (r: CallRoster): readonly QuarantinedTurn[] => r.quarantine;

/** Something the Agent (or the Witness) said, recorded against the active patient. */
export function noteUsLineOnActive(r: CallRoster, text: string): CallRoster {
  const entries = r.entries.map((e, i) =>
    i === r.activeIndex ? { ...e, session: noteUsLine(e.session, text) } : e,
  );
  return { ...r, entries };
}

/**
 * Move to another patient. Explicit by design. The rep's identity carries across in SESSION state
 * — it is the same person on the line — but no statement is copied and nothing the rep said about
 * a claim ever follows them to another claim.
 *
 * Identity deliberately does NOT become a row in the new patient's ledger. See `callIdentity` in
 * capture-gate: the gate resolves it at call level instead, so every ledger holds only what was
 * actually said about that claim.
 */
export function switchTo(r: CallRoster, claimId: ClaimId): CallRoster {
  const next = r.entries.findIndex((e) => e.brief.claimId === claimId);
  if (next < 0) throw new Error(`claim ${claimId} is not on this call`);
  if (next === r.activeIndex) return r;
  const leaving = activeEntry(r);
  const entries = r.entries.map((e, i) => {
    if (i === r.activeIndex) return { ...e, closed: true };
    if (i !== next) return e;
    return {
      ...e,
      session: { ...e.session, identity: leaving.session.identity, nameHint: leaving.session.nameHint },
    };
  });
  return { ...r, entries, activeIndex: next };
}

/**
 * Who the rep said they were on this call, wherever it was captured. One rep answers the line and
 * identifies once; the row lives in whichever claim was on screen at the time, and every claim's
 * gate cites THAT row rather than a copy.
 */
export function callIdentity(r: CallRoster): FactStatement | null {
  for (const e of r.entries) {
    const row = e.session.ledger.statements.find(
      (s): s is FactStatement => s.callId === r.callId && s.kind === 'fact' && s.category === 'rep_identity',
    );
    if (row) return row;
  }
  return null;
}

export interface RosterGate {
  claimId: ClaimId;
  patientLabel: string;
  items: GateItem[];
  clear: boolean;
  active: boolean;
}

/** One gate per patient. The call cannot close while any of them is short a required field. */
export function rosterGates(r: CallRoster): RosterGate[] {
  const identity = callIdentity(r);
  return r.entries.map((e, i) => {
    const items = computeGate(e.session.ledger, r.callId, e.brief.objectives, identity);
    return {
      claimId: e.brief.claimId,
      patientLabel: e.patientLabel,
      items,
      clear: canHangUp(items),
      active: i === r.activeIndex,
    };
  });
}

/**
 * The call may close when every patient's gate is clear AND no held turn is still waiting on the
 * Agent. An unresolved quarantine is an answer the rep actually gave sitting in limbo — hanging up
 * over it loses it for good, which is the outcome the hold exists to prevent.
 */
export const canEndCall = (r: CallRoster): boolean =>
  rosterGates(r).every((g) => g.clear) && r.quarantine.length === 0;

/** Patients still missing something, for the before-you-hang-up warning. */
export function outstanding(r: CallRoster): RosterGate[] {
  return rosterGates(r).filter((g) => !g.clear);
}
