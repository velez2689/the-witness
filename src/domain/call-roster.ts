import type { CallBrief } from './call-brief';
import { computeGate, canHangUp, type GateItem } from './capture-gate';
import { ingestRepTurn, noteUsLine, startCall, type CallSession } from './call-session';
import { appendStatement, type ClaimLedger } from './claim-ledger';
import type { Contradiction } from './contradiction';
import type { RepTurn } from './extractor';
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
}

export interface RosterIngest {
  roster: CallRoster;
  added: Statement[];
  contradictions: Contradiction[];
  /** Set when the rep spoke a member ID belonging to a different patient on this call. */
  wrongClaim: WrongClaimWarning | null;
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
 * A turn in which the rep reads ANOTHER patient's member ID is quarantined: nothing in it is
 * filed, to anyone. The rep is looking at the wrong chart, so everything they say in that breath
 * describes the wrong patient — filing it to the active claim would record something false about
 * a real patient, and re-routing it to the spoken claim would be the silent move this whole
 * module exists to refuse. The turn is dropped, the Agent is shown the challenge, and the answer
 * is captured when the rep says it again about the right patient.
 */
export function ingestToActive(r: CallRoster, turn: RepTurn): RosterIngest {
  const entry = activeEntry(r);
  const wrongClaim = checkWrongClaim(r, turn);
  if (wrongClaim) return { roster: r, added: [], contradictions: [], wrongClaim };
  // The shared counter keeps statement ids unique across the claims sharing this callId.
  const primed: CallSession = { ...entry.session, seq: r.seq };
  const result = ingestRepTurn(primed, turn);
  const entries = r.entries.map((e, i) => (i === r.activeIndex ? { ...e, session: result.session } : e));
  return {
    roster: { ...r, entries, seq: result.session.seq },
    added: result.added,
    contradictions: result.contradictions,
    wrongClaim: null,
  };
}

/** Something the Agent (or the Witness) said, recorded against the active patient. */
export function noteUsLineOnActive(r: CallRoster, text: string): CallRoster {
  const entries = r.entries.map((e, i) =>
    i === r.activeIndex ? { ...e, session: noteUsLine(e.session, text) } : e,
  );
  return { ...r, entries };
}

/**
 * Move to another patient. Explicit by design. The rep's identity carries across — it is the
 * same person on the line — but nothing else does.
 *
 * Identity carries as a STATEMENT, not just as session state, because the gate reads the ledger.
 * This is not manufacturing evidence: "on call-07 the rep identified as Darnell, badge 2210" is
 * true of every claim discussed on that call, and the row keeps the original quote and timestamp.
 * What does NOT carry is anything the rep said about the claim — that is per-patient by definition.
 */
export function switchTo(r: CallRoster, claimId: ClaimId): CallRoster {
  const next = r.entries.findIndex((e) => e.brief.claimId === claimId);
  if (next < 0) throw new Error(`claim ${claimId} is not on this call`);
  if (next === r.activeIndex) return r;
  const leaving = activeEntry(r);
  const carried = identityRow(leaving, r);
  let seq = r.seq;
  const entries = r.entries.map((e, i) => {
    if (i === r.activeIndex) return { ...e, closed: true };
    if (i !== next) return e;
    const session = { ...e.session, identity: leaving.session.identity, nameHint: leaving.session.nameHint };
    if (!carried || hasIdentity(e, r.callId)) return { ...e, session };
    seq += 1;
    const row: Statement = {
      ...carried,
      id: `stmt-${r.callId}-${String(seq).padStart(2, '0')}`,
      claimId: e.brief.claimId,
    };
    return { ...e, session: { ...session, seq, ledger: appendStatement(session.ledger, row) } };
  });
  return { ...r, entries, activeIndex: next, seq };
}

const hasIdentity = (e: RosterEntry, callId: string): boolean =>
  e.session.ledger.statements.some((s) => s.callId === callId && s.kind === 'fact' && s.category === 'rep_identity');

/** The identity statement captured for the patient being left, if the rep gave one on this call. */
function identityRow(leaving: RosterEntry, r: CallRoster): FactStatement | undefined {
  return leaving.session.ledger.statements.find(
    (s): s is FactStatement => s.callId === r.callId && s.kind === 'fact' && s.category === 'rep_identity',
  );
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
  return r.entries.map((e, i) => {
    const items = computeGate(e.session.ledger, r.callId, e.brief.objectives);
    return {
      claimId: e.brief.claimId,
      patientLabel: e.patientLabel,
      items,
      clear: canHangUp(items),
      active: i === r.activeIndex,
    };
  });
}

export const canEndCall = (r: CallRoster): boolean => rosterGates(r).every((g) => g.clear);

/** Patients still missing something, for the before-you-hang-up warning. */
export function outstanding(r: CallRoster): RosterGate[] {
  return rosterGates(r).filter((g) => !g.clear);
}
