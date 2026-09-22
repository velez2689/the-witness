import { describe, expect, it } from 'vitest';
import {
  MAX_CLAIMS_PER_CALL,
  displayName,
  findHeaderRow,
  importClaims,
  isUsable,
  mapColumns,
  normaliseDate,
  selectionBlocked,
} from '@/domain/claim-import';

/**
 * A worklist comes out of a system we do not control, with headers nobody agreed on. These
 * tests are the three major systems' export shapes, because the mapping is the whole feature:
 * get a column wrong and the Witness calls about the wrong claim.
 */

const EPIC = [
  ['Patient Accounting - AR Follow-Up Worklist'],
  ['Run date: 09/22/2026'],
  [],
  ['Account Number', 'Patient Name', 'Subscriber ID', 'Primary Payer', 'Date of Service', 'Total Charges', 'Primary Diagnosis'],
  ['A-4471-08', 'Delgado, Ricardo M', 'MD77140228', 'Meridian Health Plan', '05/18/2026', '2,840.00', 'M54.51, G89.29'],
  ['B-2290-15', 'Okonkwo, Jerome', 'MD55830417', 'Meridian Health Plan', '06/02/2026', '1615.00', 'S83.241'],
];

const CERNER = [
  ['Claim #', 'Name', 'Policy #', 'Insurance', 'Svc Date', 'Balance', 'ICD-10'],
  ['C-8812-02', 'Pilar Nazario', 'MD91662350', 'Meridian', '2026-06-11', '980', 'M25.561'],
];

const MEDITECH = [
  ['Encounter ID', 'Patient', 'Member #', 'Payor', 'From Date', 'Current Balance', 'Dx Codes'],
  ['E-5521-41', 'Osei, Ama K', 'MD31904722', 'Meridian Health Plan', '46193', '3120.00', 'S52.501'],
];

describe('finding the header in a real export', () => {
  it('skips the report title and run date above the header', () => {
    expect(findHeaderRow(EPIC)).toBe(3);
  });

  it('takes row 0 when the export has no preamble', () => {
    expect(findHeaderRow(CERNER)).toBe(0);
  });

  it('reports no header rather than guessing when the columns are not there', () => {
    const r = importClaims([['Widget', 'Colour'], ['a', 'b']]);
    expect(r.error).toMatch(/Claim Number.*Member ID|claim and member/i);
    expect(r.claims).toHaveLength(0);
  });
});

describe('column naming across systems', () => {
  it('maps an Epic-style header', () => {
    const m = mapColumns(EPIC[3]);
    expect(m.claimId).toBe(0);
    expect(m.patient).toBe(1);
    expect(m.memberId).toBe(2);
    expect(m.payer).toBe(3);
    expect(m.dateOfService).toBe(4);
  });

  it('maps a Cerner-style header', () => {
    const m = mapColumns(CERNER[0]);
    expect([m.claimId, m.patient, m.memberId, m.payer, m.dateOfService]).toEqual([0, 1, 2, 3, 4]);
  });

  it('maps a Meditech-style header', () => {
    const m = mapColumns(MEDITECH[0]);
    expect([m.claimId, m.patient, m.memberId, m.payer, m.dateOfService]).toEqual([0, 1, 2, 3, 4]);
  });

  it('prefers an exact header match over one that merely contains the word', () => {
    // "Claim Status Notes" must not win over "Claim #".
    const m = mapColumns(['Claim Status Notes', 'Claim #', 'Member ID']);
    expect(m.claimId).toBe(1);
  });

  it('leaves a field unmapped rather than guessing at an unknown column', () => {
    const m = mapColumns(['Claim #', 'Member ID', 'Wingspan']);
    expect(m.payer).toBe(-1);
    expect(m.dx).toBe(-1);
  });
});

describe('reading the rows', () => {
  it('imports an Epic worklist with dates, money and codes normalised', () => {
    const { claims } = importClaims(EPIC);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({
      claimId: 'A-4471-08',
      memberId: 'MD77140228',
      patientLabel: 'R. Delgado',
      payer: 'Meridian Health Plan',
      dateOfService: '2026-05-18',
      billed: 2840,
    });
    expect(claims[0].dxCodes).toEqual(['M54.51', 'G89.29']);
    expect(isUsable(claims[0])).toBe(true);
  });

  it('reads an Excel serial date', () => {
    const { claims } = importClaims(MEDITECH);
    expect(claims[0].dateOfService).toBe('2026-06-20');
  });

  it('carries the sheet row number so a problem can be pointed at', () => {
    const { claims } = importClaims(EPIC);
    expect(claims[0].row).toBe(5);
  });

  it('flags a row missing a member ID instead of importing it silently', () => {
    const rows = [...EPIC, ['D-1002-77', 'Bright, Alan', '', 'Meridian Health Plan', '06/20/2026', '440.00', 'M79.641']];
    const { claims } = importClaims(rows);
    const bad = claims.find((c) => c.claimId === 'D-1002-77')!;
    expect(bad.problems).toContain('no member ID');
    expect(isUsable(bad)).toBe(false);
  });

  it('skips entirely blank rows', () => {
    const { claims } = importClaims([...EPIC, [], ['', '', '', '', '', '', '']]);
    expect(claims).toHaveLength(2);
  });
});

describe('the patient label never carries a full name to the screen', () => {
  it('reduces "Last, First M" to an initial and a surname', () => {
    expect(displayName('Delgado, Ricardo M')).toBe('R. Delgado');
  });

  it('reduces "First Last" the same way', () => {
    expect(displayName('Pilar Nazario')).toBe('P. Nazario');
  });

  it('leaves a single token alone and tolerates empty input', () => {
    expect(displayName('Cher')).toBe('Cher');
    expect(displayName('   ')).toBe('');
  });
});

describe('dates as they actually arrive', () => {
  it.each([
    ['05/18/2026', '2026-05-18'],
    ['5/8/26', '2026-05-08'],
    ['2026-06-11', '2026-06-11'],
    ['46193', '2026-06-20'], // Excel serial, epoch 1899-12-30
  ])('reads %s as %s', (raw, want) => {
    expect(normaliseDate(raw)).toBe(want);
  });

  it('returns null for something that is not a date', () => {
    expect(normaliseDate('n/a')).toBeNull();
    expect(normaliseDate('')).toBeNull();
  });
});

describe('the three-claim cap', () => {
  const ok = importClaims(EPIC).claims[0];

  it('is three, because payers allow three status inquiries per rep', () => {
    expect(MAX_CLAIMS_PER_CALL).toBe(3);
  });

  it('allows selection below the cap', () => {
    expect(selectionBlocked(0, ok)).toBeNull();
    expect(selectionBlocked(2, ok)).toBeNull();
  });

  it('blocks the fourth and says why', () => {
    const why = selectionBlocked(3, ok);
    expect(why).toMatch(/3 claim-status inquiries per representative/);
  });

  it('blocks an unusable row and names what it is missing', () => {
    const rows = [...EPIC, ['D-1002-77', 'Bright, Alan', '', 'Meridian', '06/20/2026', '440.00', '']];
    const bad = importClaims(rows).claims.find((c) => c.claimId === 'D-1002-77')!;
    expect(selectionBlocked(0, bad)).toMatch(/Row 7 is missing no member ID/);
  });
});
