import type { ClaimLedger } from './claim-ledger';
import type { Contradiction, ContradictionKind } from './contradiction';
import type { FactStatement, Statement } from './statement';
import { daysBetween, isoDate } from '@/lib/dates';

/**
 * The contradiction engine. Pure: contradictions are DERIVED from the ledger and recomputable
 * from it at any time. Precision over recall — every result quotes two stored statements.
 */

const SEVERITY = {
  existenceWithRef: 100,
  valueSameBadge: 90,
  existenceNoRef: 70,
  commitment: 60,
  policy: 55,
  statusFlip: 50,
  valueOther: 45,
} as const;

const REGRESSIONS = new Set([
  'reprocessed>denied',
  'reprocessed>in process',
  'paid>denied',
  'paid>in process',
  'denied>in process',
]);

function isFact(s: Statement): s is FactStatement {
  return s.kind === 'fact';
}

function sameBadge(a: Statement, b: Statement): boolean {
  return a.speaker !== null && b.speaker !== null && a.speaker.badge === b.speaker.badge;
}

function make(
  kind: ContradictionKind,
  earlier: Statement,
  later: Statement,
  severity: number,
  related: readonly string[] = [],
): Contradiction {
  return {
    id: `${kind}:${earlier.id}:${later.id}`,
    claimId: later.claimId,
    kind,
    statementIds: [earlier.id, later.id],
    detectedAt: later.capturedAt,
    severity,
    sameBadge: sameBadge(earlier, later),
    daysApart: daysBetween(earlier.capturedAt, later.capturedAt),
    relatedStatementIds: related,
  };
}

export function detect(ledger: ClaimLedger): Contradiction[] {
  const out: Contradiction[] = [];
  const all = ledger.statements;

  all.forEach((s, index) => {
    if (!isFact(s)) return;
    const earlier = all.slice(0, index).filter(isFact).filter((e) => e.callId !== s.callId);

    // 1 · value conflict — same question, a different answer in a different call.
    if (s.category === 'denial_reason' && !s.additional) {
      const prior = earlier.filter((e) => e.category === 'denial_reason' && !e.additional && e.value !== s.value);
      const byValue = new Map<string, FactStatement>();
      for (const e of prior) {
        const current = byValue.get(e.value);
        // Prefer the same badge, then the earliest statement: what they first told you.
        if (!current || (sameBadge(e, s) && !sameBadge(current, s))) byValue.set(e.value, e);
      }
      const picks = [...byValue.values()];
      if (picks.length > 0) {
        const primary = picks.find((p) => sameBadge(p, s)) ?? picks[0];
        const related = picks.filter((p) => p !== primary).map((p) => p.id);
        out.push(
          make('value_conflict', primary, s, sameBadge(primary, s) ? SEVERITY.valueSameBadge : SEVERITY.valueOther, related),
        );
      }
    }

    // 2 · existence denial — the Rep denies a call the ledger holds.
    if (s.category === 'existence_claim' && s.subjectDate) {
      const target = earlier.filter((e) => isoDate(e.capturedAt) === s.subjectDate);
      if (target.length > 0) {
        const ref = [...target].reverse().find((e) => e.category === 'reference_number');
        out.push(make('existence_denial', ref ?? target[0], s, ref ? SEVERITY.existenceWithRef : SEVERITY.existenceNoRef));
      }
    }

    // 3 · status flip — a status regresses.
    if (s.category === 'status') {
      const prev = [...earlier].reverse().find((e) => e.category === 'status');
      if (prev && REGRESSIONS.has(`${prev.value}>${s.value}`)) {
        out.push(make('status_flip', prev, s, SEVERITY.statusFlip));
      }
    }

    // 4 · commitment violation — told to wait, then denied for timely filing.
    if (s.category === 'denial_reason' && s.value === 'timely filing') {
      const wait = earlier.find((e) => e.category === 'commitment' && e.windowDays !== undefined);
      if (wait) out.push(make('commitment_violation', wait, s, SEVERITY.commitment));
    }

    // 5 · policy inconsistency — two reps, two rules, one topic.
    if (s.category === 'policy' && s.topic) {
      const prev = earlier.find((e) => e.category === 'policy' && e.topic === s.topic && e.value !== s.value);
      if (prev) out.push(make('policy_inconsistency', prev, s, SEVERITY.policy));
    }
  });

  return out;
}

/** Contradictions that appeared between two ledger versions (the new ones after an ingest). */
export function newContradictions(before: ClaimLedger, after: ClaimLedger): Contradiction[] {
  const seen = new Set(detect(before).map((c) => c.id));
  return detect(after).filter((c) => !seen.has(c.id));
}

/** Contradictions raised by one call, grouped by the statement that triggered them, worst first. */
export function groupByTrigger(contradictions: readonly Contradiction[]): Contradiction[][] {
  const groups = new Map<string, Contradiction[]>();
  for (const c of contradictions) {
    const key = c.statementIds[1];
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()]
    .map((g) => [...g].sort((a, b) => b.severity - a.severity))
    .sort((a, b) => b[0].severity - a[0].severity);
}
