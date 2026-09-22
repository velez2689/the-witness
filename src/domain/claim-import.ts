import type { CallBrief, ObjectiveKey } from './call-brief';

/**
 * Bringing a worklist into The Witness.
 *
 * Billers do not type claims in one at a time. Epic, Cerner and Meditech all export an AR
 * worklist to a spreadsheet, and that file is the real front door: the biller opens it, picks
 * the accounts they are chasing this morning, and dials. So this module's job is to read a
 * sheet nobody designed for us, from a system we cannot see, and make sense of its columns.
 *
 * Two rules that are not arbitrary:
 *
 * THREE CLAIMS PER CALL. Payers cap a claim-status call at three claims per representative.
 * That is an industry practice, not a UI preference, so the cap lives in the domain where the
 * rule belongs and the UI cannot quietly exceed it.
 *
 * THE FILE NEVER LEAVES THE BROWSER. A worklist is full of PHI and this project has no BAA.
 * Parsing is pure and local by construction: this module takes rows of strings and returns
 * data, and the reader that produces those rows does so in the page. Nothing is uploaded.
 */

/** Payers allow three claim-status inquiries per rep on one call. */
export const MAX_CLAIMS_PER_CALL = 3;

export interface ImportedClaim {
  /** Row number in the source sheet, 1-based, for "row 14 is missing a member ID". */
  row: number;
  claimId: string;
  memberId: string;
  patientLabel: string;
  payer: string;
  dateOfService: string;
  dxCodes: readonly string[];
  billed: number | null;
  /** Empty when the row is usable. Each entry names what is missing or malformed. */
  problems: readonly string[];
}

export const isUsable = (c: ImportedClaim): boolean => c.problems.length === 0;

/**
 * Header synonyms, lowercased and stripped of punctuation before matching. Drawn from how the
 * three major systems label AR export columns; unknown headers are ignored rather than guessed
 * at, because a wrong column mapping is worse than a missing one.
 */
const FIELDS: Record<string, readonly string[]> = {
  claimId: ['claim', 'claimid', 'claimno', 'claimnumber', 'claim#', 'accountno', 'accountnumber', 'account#', 'account', 'encounter', 'encounterid', 'invoice', 'invoiceno', 'billno'],
  memberId: ['memberid', 'member#', 'member', 'subscriberid', 'subscriber#', 'subscriber', 'policyid', 'policyno', 'policy#', 'policy', 'insuranceid', 'insid', 'certificateno', 'certno'],
  patient: ['patientname', 'patient', 'name', 'ptname', 'guarantorname'],
  payer: ['payer', 'payor', 'insurance', 'insurancename', 'plan', 'planname', 'carrier', 'insuranceplan', 'primaryinsurance', 'primarypayer'],
  dateOfService: ['dateofservice', 'dos', 'servicedate', 'svcdate', 'fromdate', 'fromdos', 'servicefrom', 'datefrom', 'admitdate'],
  billed: ['billed', 'billedamount', 'totalcharges', 'charges', 'chargeamount', 'totalbilled', 'amount', 'balance', 'currentbalance', 'arbalance'],
  dx: ['diagnosis', 'diagnosiscodes', 'diagnosiscode', 'dx', 'dxcodes', 'icd', 'icd10', 'icd10codes', 'primarydiagnosis'],
};

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9#]/g, '');

/** Which column holds which field. -1 when the sheet has no column for it. */
export interface ColumnMap {
  claimId: number;
  memberId: number;
  patient: number;
  payer: number;
  dateOfService: number;
  billed: number;
  dx: number;
}

export function mapColumns(header: readonly string[]): ColumnMap {
  const cells = header.map(norm);
  const find = (key: keyof typeof FIELDS): number => {
    const names = FIELDS[key];
    // Exact match first: "claim" must not lose to a stray column containing the word.
    const exact = cells.findIndex((c) => names.includes(c));
    if (exact >= 0) return exact;
    return cells.findIndex((c) => c.length > 3 && names.some((n) => n.length > 3 && c.includes(n)));
  };
  return {
    claimId: find('claimId'),
    memberId: find('memberId'),
    patient: find('patient'),
    payer: find('payer'),
    dateOfService: find('dateOfService'),
    billed: find('billed'),
    dx: find('dx'),
  };
}

/**
 * Find the header row. Exports routinely carry a title, a run date and a blank line above the
 * real header, so the first row of the file is frequently not it. The header is the first row
 * within the first 20 that yields both a claim column and a member column.
 */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const m = mapColumns(rows[i]);
    if (m.claimId >= 0 && m.memberId >= 0) return i;
  }
  return -1;
}

/**
 * A patient identifier for the screen, reduced to an initial and a surname.
 * The full name stays in the file the biller already has; it does not need to be on a display
 * that may be shared, recorded or screenshotted.
 */
export function displayName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (s.includes(',')) {
    const [last, rest = ''] = s.split(',');
    const first = rest.trim().split(' ')[0] ?? '';
    return first ? `${first[0].toUpperCase()}. ${last.trim()}` : last.trim();
  }
  const parts = s.split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1]}`;
}

/** Spreadsheet dates arrive as text, as a serial number, or as an ISO string. */
export function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Excel serial: days since 1899-12-30. Only plausible for a date of service.
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (slash) {
    const [, a, b, y] = slash;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const mm = String(Number(a)).padStart(2, '0');
    const dd = String(Number(b)).padStart(2, '0');
    if (Number(a) >= 1 && Number(a) <= 12 && Number(b) >= 1 && Number(b) <= 31) return `${year}-${mm}-${dd}`;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

const money = (raw: string): number | null => {
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
};

const CODES = /\b[A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g;

export interface ImportResult {
  claims: readonly ImportedClaim[];
  headerRow: number;
  columns: ColumnMap | null;
  /** Set when the sheet could not be read at all. */
  error: string | null;
}

/** Turn raw sheet rows into claims. Pure: same rows in, same claims out. */
export function importClaims(rows: readonly (readonly string[])[]): ImportResult {
  if (rows.length === 0) return { claims: [], headerRow: -1, columns: null, error: 'That file has no rows in it.' };
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    return {
      claims: [],
      headerRow: -1,
      columns: null,
      error:
        'No claim and member ID columns found. The sheet needs a header row with something like "Claim Number" and "Member ID".',
    };
  }
  const columns = mapColumns(rows[headerRow]);
  const at = (r: readonly string[], i: number): string => (i >= 0 ? (r[i] ?? '').trim() : '');

  const claims: ImportedClaim[] = [];
  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.every((c) => !c || !c.trim())) continue;

    const claimId = at(r, columns.claimId);
    const memberId = at(r, columns.memberId);
    const dos = normaliseDate(at(r, columns.dateOfService));
    const problems: string[] = [];
    if (!claimId) problems.push('no claim number');
    if (!memberId) problems.push('no member ID');
    if (columns.dateOfService >= 0 && !dos) problems.push('unreadable date of service');

    claims.push({
      row: i + 1,
      claimId,
      memberId,
      patientLabel: displayName(at(r, columns.patient)),
      payer: at(r, columns.payer),
      dateOfService: dos ?? '',
      dxCodes: (at(r, columns.dx).toUpperCase().match(CODES) ?? []).slice(0, 4),
      billed: money(at(r, columns.billed)),
      problems,
    });
  }
  return { claims, headerRow, columns, error: null };
}

/**
 * Whether another claim may be selected. Returns the reason when it may not, so the UI can say
 * why rather than silently refusing a click.
 */
export function selectionBlocked(selectedCount: number, claim: ImportedClaim): string | null {
  if (!isUsable(claim)) return `Row ${claim.row} is missing ${claim.problems.join(' and ')}.`;
  if (selectedCount >= MAX_CLAIMS_PER_CALL) {
    return `Payers allow ${MAX_CLAIMS_PER_CALL} claim-status inquiries per representative on one call. Uncheck one first.`;
  }
  return null;
}

/** The objectives a freshly imported claim starts with. The Agent can change them per call. */
export const IMPORT_DEFAULT_OBJECTIVES: readonly ObjectiveKey[] = ['claim_status', 'denial_reason', 'remit_reason', 'specific_code'];

/**
 * An imported row becomes a Call Brief. Only what the sheet actually said is carried: a field the
 * export did not contain stays empty rather than being invented, because the Witness may only
 * speak facts that are in the brief.
 */
export function toCallBrief(
  claim: ImportedClaim,
  providerName: string,
  objectives: readonly ObjectiveKey[] = IMPORT_DEFAULT_OBJECTIVES,
): CallBrief {
  return {
    claimId: claim.claimId,
    payer: claim.payer,
    providerName,
    patientLabel: claim.patientLabel,
    memberId: claim.memberId,
    dateOfService: claim.dateOfService,
    dxCodes: claim.dxCodes,
    billed: claim.billed ?? 0,
    objectives,
  };
}
