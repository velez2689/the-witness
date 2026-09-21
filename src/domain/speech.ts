import type { ClaimLedger } from './claim-ledger';
import type { CallBrief, ObjectiveKey } from './call-brief';
import { OBJECTIVES, briefFacts } from './call-brief';
import type { Contradiction } from './contradiction';
import type { CallId, FactStatement, Statement } from './statement';
import { findAlnumRuns, formatReference, spellForSpeech } from '@/lib/alphanumeric';
import { sayDate } from '@/lib/dates';
import { sayNumber } from '@/lib/number-words';

/**
 * Every spoken line is assembled HERE, from statement rows. The model is a mouth, not an author:
 * it never composes a fact. `cites` names the statement ids each line quotes, so the console can
 * show the source beside what was said.
 */
export interface Utterance {
  text: string;
  cites: readonly string[];
}

const say = (text: string, cites: readonly string[] = []): Utterance => ({ text, cites });

function byId(ledger: ClaimLedger, id: string): Statement {
  const s = ledger.statements.find((x) => x.id === id);
  if (!s) throw new Error(`statement ${id} is not in the ledger`);
  return s;
}
function factOf(ledger: ClaimLedger, id: string): FactStatement {
  const s = byId(ledger, id);
  if (s.kind !== 'fact') throw new Error(`statement ${id} is not a fact`);
  return s;
}

/** "D. Reese, badge two two one zero" — or an honest "an unidentified representative". */
export function repLabel(s: Statement): string {
  return s.speaker ? `${s.speaker.name}, badge ${spellForSpeech(s.speaker.badge)}` : 'an unidentified representative';
}

/** The reference number a call produced (the confirmed row preferred), if any. */
export function callReference(ledger: ClaimLedger, callId: CallId): FactStatement | undefined {
  const rows = ledger.statements.filter(
    (s): s is FactStatement => s.callId === callId && s.kind === 'fact' && s.category === 'reference_number',
  );
  return rows.find((r) => r.confirms !== undefined) ?? rows[rows.length - 1];
}

// ---- Mode A: the Witness speaks to the Rep -------------------------------------------------

/** Spoken verbatim by TTS, never run through the LLM. Immutable after session.ready. */
export function consentGreeting(brief: CallBrief): Utterance {
  return say(
    `Hello, this is an AI assistant calling on behalf of ${brief.providerName} about a claim. ` +
      'This call is being recorded. May I have your name and badge number?',
  );
}

export function verifyClaim(brief: CallBrief): Utterance {
  return say(
    `Thank you. The member ID is ${spellForSpeech(brief.memberId)}, date of service ${sayDate(brief.dateOfService)}. ` +
      `What is the current status of claim ${spellForSpeech(brief.claimId)}?`,
  );
}

export function askObjective(key: ObjectiveKey): Utterance {
  return say(OBJECTIVES[key].ask);
}

export function askIdentityAgain(): Utterance {
  return say('Could I please get your name and badge number for the record?');
}

export function askReference(): Utterance {
  return say('Could I get a reference number for this call?');
}

export function readback(reference: string): Utterance {
  return say(`Let me read that back: ${spellForSpeech(reference)}. Is that correct?`);
}

/** A contradiction stated back to the Rep on the recorded line: quote, cite, ask ONE question. */
export function challenge(ledger: ClaimLedger, c: Contradiction): Utterance {
  const [earlierId, laterId] = c.statementIds;
  const earlier = factOf(ledger, earlierId);
  const later = factOf(ledger, laterId);
  const when = sayDate(earlier.capturedAt);
  const ref = callReference(ledger, earlier.callId);
  const refPart = ref ? `, reference ${spellForSpeech(ref.value)}` : '';
  const cites = [earlierId, laterId, ...(ref ? [ref.id] : [])];

  switch (c.kind) {
    case 'value_conflict':
      return say(
        `Before we go on: on ${when}, ${repLabel(earlier)}${refPart}, recorded the denial reason as ${earlier.value}. ` +
          `${c.sameBadge ? 'That is the same badge you gave today. ' : ''}Today the reason is ${later.value}. Which reason is on the claim?`,
        cites,
      );
    case 'existence_denial': {
      const target = ledger.statements.find((s) => s.id === earlierId)!;
      return say(
        `Our record shows a call on ${when} with ${repLabel(target)}${ref ? `, reference ${spellForSpeech(ref.value)}` : ''}. ` +
          'Can you look up that reference?',
        cites,
      );
    }
    case 'status_flip':
      return say(
        `On ${when}, ${repLabel(earlier)}${refPart}, recorded the status as ${earlier.value}. Today it shows ${later.value}. Which status is correct?`,
        cites,
      );
    case 'commitment_violation': {
      const days = earlier.windowDays ?? 0;
      return say(
        `On ${when}, ${repLabel(earlier)}${refPart}, instructed us to allow ${sayNumber(days)} days. ` +
          `The claim is now denied as ${later.value}. Can you confirm how that instruction applies?`,
        cites,
      );
    }
    case 'policy_inconsistency':
      return say(
        `On ${when}, ${repLabel(earlier)}${refPart}, stated ${earlier.value} for ${earlier.topic ?? 'this rule'}. Today it is ${later.value}. Which is correct?`,
        cites,
      );
  }
}

/** Ask a Rep to confirm a prior call the ledger holds, citing the payer's own reference. */
export function probePriorCall(ledger: ClaimLedger, statusId: string): Utterance {
  const status = factOf(ledger, statusId);
  const ref = callReference(ledger, status.callId);
  return say(
    `On ${sayDate(status.capturedAt)}, ${repLabel(status)}${ref ? `, reference ${spellForSpeech(ref.value)}` : ''}, ` +
      `recorded this claim as ${status.value}. Can you confirm that on your end?`,
    ref ? [status.id, ref.id] : [status.id],
  );
}

/** Spoken to the Rep at the end of a Mode A call, from the statement rows only. */
export function closeOutForRep(ledger: ClaimLedger, callId: CallId): Utterance {
  const inCall = ledger.statements.filter((s) => s.callId === callId);
  const cites: string[] = [];
  const parts: string[] = [];
  const ident = inCall.find((s): s is FactStatement => s.kind === 'fact' && s.category === 'rep_identity');
  if (ident?.speaker) {
    parts.push(`representative ${repLabel(ident)}`);
    cites.push(ident.id);
  }
  const reason = [...inCall].reverse().find(
    (s): s is FactStatement => s.kind === 'fact' && s.category === 'denial_reason' && !s.additional,
  );
  if (reason) {
    parts.push(`the denial reason is ${reason.value}`);
    cites.push(reason.id);
  }
  const ref = callReference(ledger, callId);
  if (ref) {
    parts.push(`reference number ${spellForSpeech(ref.value)}`);
    cites.push(ref.id);
  }
  return say(`Thank you. To confirm what I recorded: ${parts.join('; ')}. This call was recorded. Goodbye.`, cites);
}

// ---- Mode B: whispered to the Agent ---------------------------------------------------------

/** No pronouns are inferred for the Rep: lines say "the rep" and quote the badge. */
export function whisperFor(ledger: ClaimLedger, c: Contradiction): Utterance {
  const [earlierId, laterId] = c.statementIds;
  const earlier = factOf(ledger, earlierId);
  const later = factOf(ledger, laterId);
  const cites = [earlierId, laterId];
  switch (c.kind) {
    case 'value_conflict':
      return say(
        `${earlier.speaker?.name ?? 'A rep'} said ${earlier.value} on ${sayDate(earlier.capturedAt)}.` +
          `${c.sameBadge ? ' Same badge.' : ''} Ask which reason is on the remit.`,
        cites,
      );
    case 'existence_denial': {
      const ref = callReference(ledger, earlier.callId);
      return say(
        `We have their reference number for that call${ref ? `, ${spellForSpeech(ref.value)}` : ''}. Read it back to the rep.`,
        ref ? [...cites, ref.id] : cites,
      );
    }
    case 'status_flip':
      return say(`It was ${earlier.value} on ${sayDate(earlier.capturedAt)}, now ${later.value}. Ask what changed.`, cites);
    case 'commitment_violation':
      return say(
        `They told you to allow ${sayNumber(earlier.windowDays ?? 0)} days on ${sayDate(earlier.capturedAt)}. Ask how that squares with ${later.value}.`,
        cites,
      );
    case 'policy_inconsistency':
      return say(`Two reps disagree on ${earlier.topic ?? 'this rule'}. Ask which one applies.`, cites);
  }
}

export function whisperReadback(reference: string): Utterance {
  return say(`I heard ${spellForSpeech(reference)}. Ask the rep to repeat it.`);
}

export function whisperMissing(label: string): Utterance {
  return say(`No ${label.toLowerCase()} yet. Ask before you hang up.`);
}

// ---- Close-Out: spoken to the Agent, rendered from rows ------------------------------------

/**
 * Missing fields are spoken as missing, unconfirmed as unconfirmed, and no row means no line.
 * Never free-form summarization: every sentence traces to a statement.
 */
export function closeOutForAgent(
  ledger: ClaimLedger,
  callId: CallId,
  contradictions: readonly Contradiction[],
  holdSeconds: number,
): Utterance {
  const inCall = ledger.statements.filter((s) => s.callId === callId);
  const cites: string[] = [];
  const lines: string[] = ['Call closed.'];

  const ident = inCall.find((s): s is FactStatement => s.kind === 'fact' && s.category === 'rep_identity');
  if (ident) {
    lines.push(`${repLabel(ident)}.`);
    cites.push(ident.id);
  } else lines.push('No representative name or badge was captured.');

  const ref = callReference(ledger, callId);
  if (ref) {
    lines.push(
      `Reference ${spellForSpeech(ref.value)}${ref.confirms !== undefined || ref.confidence === 'captured_confirmed' ? '' : ', unconfirmed'}.`,
    );
    cites.push(ref.id);
  } else lines.push('No reference number was captured on this call.');

  const reason = [...inCall].reverse().find(
    (s): s is FactStatement => s.kind === 'fact' && s.category === 'denial_reason' && !s.additional,
  );
  if (reason) {
    const conflict = contradictions.find((c) => c.kind === 'value_conflict' && c.statementIds[1] === reason.id);
    lines.push(`Denial reason today: ${reason.value}.`);
    cites.push(reason.id);
    if (conflict) {
      const prior = factOf(ledger, conflict.statementIds[0]);
      lines.push(
        `Conflicts with ${conflict.sameBadge ? "the same representative's" : `${prior.speaker?.name ?? 'an earlier'}'s`} ${sayDate(prior.capturedAt)} statement of ${prior.value}.`,
      );
      cites.push(prior.id);
    }
  }

  for (const r of inCall.filter((s) => s.kind === 'refusal')) {
    lines.push(`${r.category.replace(/_/g, ' ')}: not provided, refused.`);
    cites.push(r.id);
  }

  for (const c of contradictions.filter((x) => x.kind === 'existence_denial')) {
    const prior = factOf(ledger, c.statementIds[0]);
    const pref = callReference(ledger, prior.callId);
    lines.push(
      `No record acknowledged of the ${sayDate(prior.capturedAt)} call${pref ? `, contradicted by reference ${spellForSpeech(pref.value)}` : ''}.`,
    );
    cites.push(prior.id);
  }

  if (holdSeconds > 0) {
    lines.push(`${Math.floor(holdSeconds / 60)} minutes ${holdSeconds % 60} seconds on hold.`);
  }
  return say(lines.join(' '), cites);
}

// ---- Pre-call briefing (Mode B) --------------------------------------------------------------

export function briefing(ledger: ClaimLedger): Utterance {
  const callIds = [...new Set(ledger.statements.map((s) => s.callId))];
  const last = ledger.statements.filter((s) => s.callId === callIds[callIds.length - 1]);
  const ident = last.find((s): s is FactStatement => s.kind === 'fact' && s.category === 'rep_identity');
  const missing = callIds.filter((id) => !callReference(ledger, id));
  const parts = [`This claim has ${sayNumber(callIds.length)} prior calls.`];
  if (ident) parts.push(`The last was with ${repLabel(ident)}.`);
  if (missing.length > 0) parts.push(`${sayNumber(missing.length)} of them have no reference number.`);
  return say(parts.join(' '), ident ? [ident.id] : []);
}

// ---- Self-check: nothing spoken that is not in the record ----------------------------------

/**
 * Diff the alphanumerics in what the agent actually said (`transcript.agent`) against the
 * statement log and the brief. Any token not present is a fabrication bug, caught automatically.
 */
export function checkSpeech(
  spoken: string,
  ledger: ClaimLedger,
  brief: CallBrief,
): { ok: boolean; unknown: string[] } {
  const allowed = new Set<string>();
  const add = (v: string | undefined | null) => {
    if (v) allowed.add(v.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
  };
  for (const f of briefFacts(brief)) add(f);
  for (const s of ledger.statements) {
    if (s.kind === 'fact') {
      add(s.value);
      add(s.speaker?.badge);
    } else add(s.speaker?.badge);
  }
  const unknown = findAlnumRuns(spoken, 4)
    .map((r) => formatReference(r.raw))
    .filter((v) => !allowed.has(v.replace(/[^A-Za-z0-9]/g, '').toUpperCase()));
  return { ok: unknown.length === 0, unknown };
}
