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
/**
 * A rep's name and badge, for speaking aloud.
 *
 * The period after an initial is dropped. "D. Reese" makes the TTS treat the initial as the end
 * of a sentence and pause - heard as "D... Reese", which a listener called out as one of the
 * clearest robotic tells in the whole line. The stored name keeps its period; only the spoken
 * form loses it.
 */
export function repLabel(s: Statement): string {
  if (!s.speaker) return 'an unidentified representative';
  const spoken = s.speaker.name.replace(/\b([A-Z])\.(?=\s)/g, '$1');
  return `${spoken}, badge ${spellForSpeech(s.speaker.badge)}`;
}

/** The reference number a call produced (the confirmed row preferred), if any. */
export function callReference(ledger: ClaimLedger, callId: CallId): FactStatement | undefined {
  const rows = ledger.statements.filter(
    (s): s is FactStatement => s.callId === callId && s.kind === 'fact' && s.category === 'reference_number',
  );
  return rows.find((r) => r.confirms !== undefined) ?? rows[rows.length - 1];
}

// ---- Mode A: the Witness speaks to the Rep -------------------------------------------------

/*
 * Everything below is spoken aloud, so it is written the way a biller talks rather than the way
 * a claim note reads. The facts and citations are unchanged - same date, same badge, same
 * reference - because those are assembled from statement rows and must stay exact. Only the
 * connective language is conversational. A tester's verdict on the earlier phrasing was "very
 * robotic", and most of that was the script, not the voice.
 */

/** Spoken verbatim by TTS, never run through the LLM. Immutable after session.ready. */
export function consentGreeting(brief: CallBrief): Utterance {
  return say(
    `Hi, this is an AI assistant calling for ${brief.providerName} about a claim, ` +
      "and just so you know, this call is recorded. Could I get your name and badge number?",
  );
}

export function verifyClaim(brief: CallBrief): Utterance {
  return say(
    `Thanks. So that's member ${spellForSpeech(brief.memberId)}, date of service ${sayDate(brief.dateOfService)}. ` +
      `Can you tell me where claim ${spellForSpeech(brief.claimId)} stands right now?`,
  );
}

export function askObjective(key: ObjectiveKey): Utterance {
  return say(OBJECTIVES[key].ask);
}

export function askIdentityAgain(): Utterance {
  return say("Sorry, I didn't catch your name and badge number. Could I get those for the record?");
}

export function askReference(): Utterance {
  return say('And can I grab a reference number for this call?');
}

export function readback(reference: string): Utterance {
  return say(`Let me read that back to you. ${spellForSpeech(reference)}. Did I get that right?`);
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
        `Hang on, before we go further. I've got a note here from ${when}. ${repLabel(earlier)}${refPart} ` +
          `told us it was denied for ${earlier.value}. ` +
          `${c.sameBadge ? "That's the same badge you just gave me. " : ''}` +
          `Today you're saying ${later.value}. So which one is actually on the claim?`,
        cites,
      );
    case 'existence_denial': {
      const target = ledger.statements.find((s) => s.id === earlierId)!;
      return say(
        `We do have that call though. ${when}, with ${repLabel(target)}${ref ? `, and they gave us reference ${spellForSpeech(ref.value)}` : ''}. ` +
          'Could you pull that up on your end?',
        cites,
      );
    }
    case 'status_flip':
      return say(
        `One thing - back on ${when}, ${repLabel(earlier)}${refPart} had this as ${earlier.value}. Now you're telling me ${later.value}. Which one is right?`,
        cites,
      );
    case 'commitment_violation': {
      const days = earlier.windowDays ?? 0;
      return say(
        `So on ${when}, ${repLabel(earlier)}${refPart} told us to give it ${sayNumber(days)} days. ` +
          `We did that, and now it's denied for ${later.value}. Can you help me understand what happened there?`,
        cites,
      );
    }
    case 'policy_inconsistency':
      return say(
        `On ${when}, ${repLabel(earlier)}${refPart} told us ${earlier.value} for ${earlier.topic ?? 'this'}. Today you're saying ${later.value}. Which one applies?`,
        cites,
      );
  }
}

/** Ask a Rep to confirm a prior call the ledger holds, citing the payer's own reference. */
export function probePriorCall(ledger: ClaimLedger, statusId: string): Utterance {
  const status = factOf(ledger, statusId);
  const ref = callReference(ledger, status.callId);
  return say(
    `Quick one - on ${sayDate(status.capturedAt)}, ${repLabel(status)}${ref ? `, reference ${spellForSpeech(ref.value)}` : ''} ` +
      `had this claim as ${status.value}. Can you confirm that on your end?`,
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
  const norm = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const runs = findAlnumRuns(spoken, 4).map((r) => formatReference(r.raw));

  /*
   * An identifier is spoken in groups, so the transcript can come back split - "8K2J" then "988"
   * where the ledger holds "8K2J-988". Checking each fragment alone would report the agent
   * fabricating "8K2J", which is the opposite of the truth and would train the operator to
   * ignore the one alarm that must never be ignored. So a fragment is only unknown once it
   * fails to join with its neighbour into something on record.
   */
  const unknown: string[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    if (allowed.has(norm(runs[i]))) continue;
    const joined = i + 1 < runs.length ? norm(runs[i]) + norm(runs[i + 1]) : null;
    if (joined && allowed.has(joined)) {
      i += 1; // both halves accounted for
      continue;
    }
    unknown.push(runs[i]);
  }
  return { ok: unknown.length === 0, unknown };
}
