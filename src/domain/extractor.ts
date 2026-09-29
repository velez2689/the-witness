import type { ConfidenceState, Speaker, StatementCategory } from './statement';
import { findAlnumRuns, formatReference, parseSpokenDigits } from '@/lib/alphanumeric';
import { parseMonthDay } from '@/lib/dates';
import { parseNumberWords } from '@/lib/number-words';
import { findSpokenCodes } from '@/lib/spoken-codes';
import { claimStatusCode, remarkCode } from './x12-codes';

/** A finalized Rep turn. Extraction never runs on partials. */
export interface RepTurn {
  text: string;
  startMs: number;
  endMs: number;
  /** The STT was unsure of something in this turn (degraded audio). */
  lowConfidence?: boolean;
}

/** What the Agent (or the Witness) most recently asked the Rep for. Drives refusal detection. */
export type AskKind = 'rep_identity' | 'diagnosis_code' | 'reference_number' | 'remark_code';

export interface ExtractContext {
  capturedAt: string;
  identity: { first: string | null; badge: string | null };
  askedFor: AskKind | null;
  /** Reps already in the ledger, to resolve "badge 2210" to a full name. */
  knownReps: readonly Speaker[];
  /** Surname noted by the Agent for this call, if any. */
  nameHint: string | null;
  /**
   * Member IDs of every patient on this call. A rep reading one aloud must never be filed
   * as a reference number, on a multi-patient call that is how ledgers get contaminated.
   */
  knownMemberIds?: readonly string[];
}

interface DraftBase {
  span: { quote: string; startMs: number; endMs: number };
  confidence: ConfidenceState;
}
export interface FactDraft extends DraftBase {
  kind: 'fact';
  category: StatementCategory;
  value: string;
  topic?: string;
  additional?: boolean;
  windowDays?: number;
  subjectDate?: string;
}
export interface RefusalDraft extends DraftBase {
  kind: 'refusal';
  category: string;
}
export type Draft = FactDraft | RefusalDraft;

export interface Extraction {
  drafts: Draft[];
  identity: { first: string | null; badge: string | null; name: string | null };
}

const NAME_FILLER = new Set(['it\'s', 'its', 'my', 'name', 'is', 'speaking', 'here', 'this', 'i\'m', 'im', 'the', 'a', 'an', 'yes', 'yeah', 'hi', 'hello']);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"()[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const DEFLECTION =
  /(don'?t|do not) have that level of detail|(doesn'?t|does not) (specify|say)|refer you to the denial letter|you should have (gotten|received) a letter|how can i help you|just says the diagnosis/;

export function extractFromTurn(turn: RepTurn, ctx: ExtractContext): Extraction {
  const text = turn.text.replace(/[‘’]/g, "'");
  const lower = text.toLowerCase();
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const drafts: Draft[] = [];
  const year = Number(ctx.capturedAt.slice(0, 4));
  const factConfidence: ConfidenceState = turn.lowConfidence ? 'captured_unconfirmed' : 'captured_confirmed';

  const quoteFor = (re: RegExp): DraftBase['span'] => {
    let offset = 0;
    for (const s of sentences) {
      const at = text.indexOf(s, offset);
      offset = at + s.length;
      if (re.test(s.toLowerCase())) {
        const total = Math.max(text.length, 1);
        const dur = turn.endMs - turn.startMs;
        return {
          quote: s,
          startMs: turn.startMs + Math.round((at / total) * dur),
          endMs: turn.startMs + Math.round(((at + s.length) / total) * dur),
        };
      }
    }
    return { quote: text, startMs: turn.startMs, endMs: turn.endMs };
  };
  const fact = (
    category: StatementCategory,
    value: string,
    re: RegExp,
    extra: Partial<FactDraft> = {},
  ): void => {
    drafts.push({ kind: 'fact', category, value, span: quoteFor(re), confidence: factConfidence, ...extra });
  };

  // --- identity -------------------------------------------------------------------------
  let first = ctx.identity.first;
  let badge = ctx.identity.badge;
  const who = /\bthis is ([a-z]+)/.exec(lower);
  if (who && !['the', 'a', 'an'].includes(who[1])) {
    first = who[1][0].toUpperCase() + who[1].slice(1);
  } else if (!first && ctx.askedFor === 'rep_identity') {
    // A bare answer to "your name and badge?": "Smith.", "It's Smith", "Smith speaking" (live call
    // 2026-09-29 12:57, where "Smith." alone was never taken as a name).
    const words = tokenize(lower).filter((w) => !NAME_FILLER.has(w));
    if (words.length >= 1 && words.length <= 2 && !/\d/.test(lower)) {
      first = words[0][0].toUpperCase() + words[0].slice(1);
    }
  }
  // Badges are three to six digits in the wild; the demo payer's are four (live call 12:57: "227").
  const BADGE_LEN = { min: 3, max: 6 };
  const badgeAt = lower.indexOf('badge');
  if (badgeAt >= 0) {
    const rest = lower.slice(badgeAt + 5).split(/[.?!]/)[0];
    badge = parseSpokenDigits(rest, BADGE_LEN) ?? badge;
  } else if (!badge && ctx.askedFor !== 'reference_number' && text.split(/\s+/).length <= 6) {
    badge = parseSpokenDigits(lower, BADGE_LEN) ?? badge;
  }
  const known = badge ? ctx.knownReps.find((r) => r.badge === badge) : undefined;
  const surname = ctx.nameHint ?? known?.name.replace(/^[A-Z]\.\s*/, '') ?? null;
  const name = first && surname ? `${first[0]}. ${surname}` : (known?.name ?? first);
  const identityChanged = first !== ctx.identity.first || badge !== ctx.identity.badge;
  if (identityChanged && first && badge) {
    drafts.push({
      kind: 'fact',
      category: 'rep_identity',
      value: `${name} ${badge}`,
      span: quoteFor(/badge|this is/),
      confidence: known || ctx.nameHint ? 'captured_confirmed' : 'captured_unconfirmed',
    });
  }

  // --- reference numbers ----------------------------------------------------------------
  const memberIds = new Set((ctx.knownMemberIds ?? []).map((m) => m.replace(/[^A-Za-z0-9]/g, '').toUpperCase()));
  for (const run of findAlnumRuns(text)) {
    if (memberIds.has(run.raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase())) continue;
    drafts.push({
      kind: 'fact',
      category: 'reference_number',
      value: formatReference(run.raw),
      span: { quote: text, startMs: turn.startMs, endMs: turn.endMs },
      // A reference number is unconfirmed until it is read back and the Rep agrees.
      confidence: 'captured_unconfirmed',
    });
  }

  // --- denial reasons -------------------------------------------------------------------
  const additional = /\balso\b|\banother\b/.test(lower);
  if (/\bno (?:prior )?auth/.test(lower)) {
    fact('denial_reason', 'no prior authorization', /\bno (?:prior )?auth/);
  }
  if (/timely filing/.test(lower)) {
    fact('denial_reason', 'timely filing', /timely filing/, { additional });
  }
  if (/denying on a diagnosis|diagnosis (issue|isn'?t supported|is not supported)|just says the diagnosis/.test(lower)) {
    fact('denial_reason', 'diagnosis code', /diagnosis/, { additional });
  }
  // Heard on the 2026-09-29 live calls and not typed until now: "non-covered" / "denied for
  // non-coverage", and "an issue with the CPT code" (a category with no value, so the plan
  // then asks which code, as it does for a diagnosis issue).
  if (/\bnon-?\s?cover(?:ed|age)\b|\bnot covered\b/.test(lower)) {
    fact('denial_reason', 'non-covered', /non-?\s?cover(?:ed|age)|not covered/, { additional });
  }
  if (/\b(?:cpt|procedure) code\b|\bcoding (?:issue|error|problem)\b/.test(lower) && !/\bwhich\b/.test(lower)) {
    fact('denial_reason', 'procedure code', /(?:cpt|procedure) code|coding (?:issue|error|problem)/, { additional });
  }

  // --- status ---------------------------------------------------------------------------
  const reprocessed =
    /(?:was|is|been) reprocessed|shows reprocessed|showing reprocessed/.test(lower) &&
    !/not seeing a reprocess/.test(lower);
  if (reprocessed) {
    const subjectDate = parseMonthDay(text, year) ?? undefined;
    fact('status', 'reprocessed', /reprocessed/, { subjectDate });
  } else if (/\b(denied|denial|denying)\b/.test(lower)) {
    fact('status', 'denied', /\b(denied|denial|denying)\b/);
  }
  if (/in process/.test(lower)) {
    fact('status', 'in process', /in process/);
  }

  // --- commitments ----------------------------------------------------------------------
  const allow = /allow ([a-z0-9-]+(?: [a-z]+)?) days/.exec(lower);
  const allowDays = allow ? parseNumberWords(allow[1]) : null;
  if (allowDays) {
    fact('commitment', `wait ${allowDays} days`, /allow/, { windowDays: allowDays });
  }
  const range = /give it (?:another )?([a-z0-9-]+) to ([a-z0-9-]+) days/.exec(lower);
  if (range) {
    const lo = parseNumberWords(range[1]);
    const hi = parseNumberWords(range[2]);
    if (lo && hi) fact('commitment', `wait ${lo}-${hi} days`, /give it/, { windowDays: hi });
  }

  // --- existence denial -----------------------------------------------------------------
  if (/(?:don'?t|do not) have a record of (?:a|that|the) call/.test(lower)) {
    fact('existence_claim', 'no record of call', /record of/, {
      subjectDate: parseMonthDay(text, year) ?? undefined,
    });
  }

  // --- X12 codes read aloud ---------------------------------------------------------------
  // A code on the current X12 list is filed as confirmed; a well-formed code that is not on the
  // list, or a CARC (no list is shipped), is filed unconfirmed and the plan reads it back, the
  // same rule as a reference number. Only identifiers are known here, never what a code means.
  for (const c of findSpokenCodes(text)) {
    const category = c.kind === 'remark' ? 'remark_code' : c.kind === 'status' ? 'claim_status_code' : 'denial_code';
    const known = c.kind === 'remark' ? remarkCode(c.code) : c.kind === 'status' ? claimStatusCode(c.code) : null;
    drafts.push({
      kind: 'fact',
      category,
      value: c.code,
      span: { quote: text, startMs: turn.startMs, endMs: turn.endMs },
      confidence: known?.known && known.active ? 'captured_confirmed' : 'captured_unconfirmed',
    });
  }

  // --- refusal: a category named or asked for, with no value given ----------------------
  if (ctx.askedFor && DEFLECTION.test(lower)) {
    const gaveRef = ctx.askedFor === 'reference_number' && findAlnumRuns(text).length > 0;
    if (!gaveRef) {
      drafts.push({
        kind: 'refusal',
        category: ctx.askedFor,
        span: quoteFor(DEFLECTION),
        confidence: 'not_captured',
      });
    }
  }

  return { drafts, identity: { first, badge, name: name ?? null } };
}

/** What did the Agent / Witness just ask for? Null when the line is not a request for a specific value. */
export function classifyAsk(text: string, lastReasonWasDiagnosis: boolean): AskKind | null {
  const t = text.toLowerCase();
  if (/name and badge|your name|badge number/.test(t)) return 'rep_identity';
  if (/reference number|reference for today/.test(t)) return 'reference_number';
  if (/remark code/.test(t)) return 'remark_code';
  if (/which (diagnosis )?code|which diagnosis|is it the primary/.test(t)) return 'diagnosis_code';
  if (/which one/.test(t) && lastReasonWasDiagnosis) return 'diagnosis_code';
  return null;
}
