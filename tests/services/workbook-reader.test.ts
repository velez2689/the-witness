import { deflateRawSync, crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseDelimited, readWorkbook } from '@/services/workbook-reader';

/**
 * The reader has no dependency to trust, so it needs a test against a real .xlsx — a genuine
 * ZIP with deflated XML members, built here rather than committed as a binary blob.
 */

function xlsx(rows: readonly (readonly string[])[], sheetName = 'AR Worklist'): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = (i: number) => {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  const sheetData = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">` +
        r.map((c, ci) => (c === '' ? '' : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`)).join('') +
        `</row>`,
    )
    .join('');

  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook><sheets><sheet name="${esc(sheetName)}" sheetId="1"/></sheets></workbook>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${sheetData}</sheetData></worksheet>`,
  };

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const comp = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, eocd]));
}

const asFile = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name);

const WORKLIST = [
  ['Patient Accounting - AR Follow-Up Worklist'],
  ['Run date: 09/22/2026'],
  [],
  ['Account Number', 'Patient Name', 'Subscriber ID', 'Primary Payer', 'Date of Service', 'Total Charges'],
  ['A-4471-08', 'Delgado, Ricardo M', 'MD77140228', 'Meridian Health Plan', '05/18/2026', '2840.00'],
  ['B-2290-15', 'Okonkwo, Jerome', 'MD55830417', 'Meridian Health Plan', '06/02/2026', '1615.00'],
];

describe('reading a real .xlsx with no library', () => {
  it('inflates the zip and returns the sheet rows', async () => {
    const out = await readWorkbook(asFile(xlsx(WORKLIST), 'worklist.xlsx'));
    expect(out.sheetName).toBe('AR Worklist');
    expect(out.rows[3][0]).toBe('Account Number');
    expect(out.rows[4]).toEqual(['A-4471-08', 'Delgado, Ricardo M', 'MD77140228', 'Meridian Health Plan', '05/18/2026', '2840.00']);
  });

  it('keeps blank leading rows so row numbers match what the biller sees in Excel', async () => {
    const out = await readWorkbook(asFile(xlsx(WORKLIST), 'worklist.xlsx'));
    expect(out.rows[0][0]).toContain('AR Follow-Up Worklist');
    expect(out.rows[2] ?? []).toEqual([]);
  });

  it('decodes XML entities rather than showing them raw', async () => {
    // The helper escapes on the way in, exactly as Excel does, so this round-trips through
    // a genuine &amp; in the stored XML.
    const rows = [['Claim', 'Member ID', 'Payer'], ['A-1', 'M-1', 'Smith & Sons Health <East>']];
    const out = await readWorkbook(asFile(xlsx(rows), 'w.xlsx'));
    expect(out.rows[1][2]).toBe('Smith & Sons Health <East>');
  });

  it('explains the older .xls format instead of failing obscurely', async () => {
    await expect(readWorkbook(asFile(new Uint8Array([1, 2, 3]), 'old.xls'))).rejects.toThrow(/Save As/);
  });

  it('rejects a file that is not a spreadsheet at all', async () => {
    await expect(readWorkbook(asFile(new Uint8Array([1]), 'notes.pdf'))).rejects.toThrow(/\.xlsx or a? ?\.csv/i);
  });

  it('says so plainly when the zip is corrupt', async () => {
    await expect(readWorkbook(asFile(new Uint8Array(64), 'broken.xlsx'))).rejects.toThrow(/not a readable/i);
  });
});

describe('reading a CSV export', () => {
  it('handles quoted fields, commas inside them and doubled quotes', () => {
    const rows = parseDelimited('Claim,Patient,Payer\nA-1,"Delgado, Ricardo","He said ""hi"""\n');
    expect(rows[1]).toEqual(['A-1', 'Delgado, Ricardo', 'He said "hi"']);
  });

  it('handles CRLF line endings and a UTF-8 BOM', () => {
    const rows = parseDelimited('﻿Claim,Member\r\nA-1,M-1\r\n');
    expect(rows[0]).toEqual(['Claim', 'Member']);
    expect(rows[1]).toEqual(['A-1', 'M-1']);
  });

  it('keeps a newline that lives inside a quoted field', () => {
    const rows = parseDelimited('Claim,Note\nA-1,"line one\nline two"\n');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('line one\nline two');
  });

  it('reads a .csv file end to end', async () => {
    const bytes = new TextEncoder().encode('Claim Number,Member ID\nA-4471-08,MD77140228\n');
    const out = await readWorkbook(asFile(bytes, 'export.csv'));
    expect(out.rows[1]).toEqual(['A-4471-08', 'MD77140228']);
  });
});
