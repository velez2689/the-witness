/**
 * Builds public/sample-ar-worklist.xlsx — the file a judge (or anyone without a billing system)
 * uploads to try the import. Shaped like a real Epic AR follow-up export: a report title and a
 * run date above the header, "Account Number" rather than "Claim", names as "Last, First M",
 * US dates, money with thousands separators, and one row missing a member ID so the validation
 * has something honest to catch.
 *
 * All data is synthetic. Run: node fixtures/scripts/make-worklist.mjs
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const ROWS = [
  ['Patient Accounting \u2014 AR Follow-Up Worklist'],
  ['Facility: Harbor Orthopedic \u00b7 Run date: 09/22/2026 \u00b7 Filter: Denied + No Response > 60 days'],
  [],
  ['Account Number', 'Patient Name', 'Subscriber ID', 'Primary Payer', 'Date of Service', 'Total Charges', 'Primary Diagnosis', 'AR Days', 'Last Status'],
  ['K-6120-33', 'Hartley, Denise R', 'MD20447715', 'Meridian Health Plan', '05/18/2026', '2,840.00', 'M54.51, G89.29', '127', 'Denied - conflicting reasons'],
  ['L-7741-08', 'Okonkwo, Jerome', 'MD55830417', 'Meridian Health Plan', '06/02/2026', '1,615.00', 'S83.241', '112', 'Denied - no prior auth'],
  ['M-3308-24', 'Nazario, Pilar', 'MD91662350', 'Meridian Health Plan', '06/11/2026', '980.00', 'M25.561', '103', 'No response'],
  ['D-1002-77', 'Bright, Alan T', '', 'Meridian Health Plan', '06/20/2026', '440.00', 'M79.641', '94', 'No response'],
  ['E-5521-41', 'Osei, Ama K', 'MD31904722', 'Meridian Health Plan', '07/01/2026', '3,120.00', 'S52.501', '83', 'Denied - timely filing'],
  ['F-3390-19', 'Vasquez, Lucia', 'MD44218806', 'Meridian Health Plan', '07/09/2026', '1,275.00', 'M17.11', '75', 'Pending review'],
  ['G-7734-55', 'Ilunga, Patrice', 'MD60553914', 'Meridian Health Plan', '07/22/2026', '2,050.00', 'S42.001', '62', 'No response'],
  ['H-9081-23', 'Petrov, Nadia', 'MD88170265', 'Northstar Mutual', '08/03/2026', '760.00', 'M75.101', '50', 'Denied - coding'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => { let s = '', n = i + 1; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };

const sheetData = ROWS.map((r, ri) =>
  `<row r="${ri + 1}">` +
  r.map((c, ci) => (c === '' || c === undefined ? '' : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`)).join('') +
  `</row>`).join('');

const files = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="AR Worklist" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
};

const parts = [], central = [];
let offset = 0;
for (const [name, content] of Object.entries(files)) {
  const raw = Buffer.from(content, 'utf8');
  const comp = deflateRawSync(raw);
  const crc = crc32(raw) >>> 0;
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  parts.push(local, nameBuf, comp);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
  central.push(cd, nameBuf);
  offset += local.length + nameBuf.length + comp.length;
}
const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(Object.keys(files).length, 8);
eocd.writeUInt16LE(Object.keys(files).length, 10);
eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
writeFileSync('public/sample-ar-worklist.xlsx', Buffer.concat([...parts, cdBuf, eocd]));
console.log('wrote public/sample-ar-worklist.xlsx', ROWS.length - 4, 'claim rows');
