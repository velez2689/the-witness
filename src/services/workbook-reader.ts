/**
 * Reads a worklist file into rows of strings, entirely in the page.
 *
 * NOTHING IS UPLOADED. An AR worklist is full of PHI and this project has no BAA, so the file
 * is read with FileReader and parsed here; no fetch, no form post, no telemetry. That is not a
 * policy note, it is the implementation: there is no network call in this module.
 *
 * An .xlsx is a ZIP of XML, and the platform can already do both halves — DecompressionStream
 * for the deflate and DOMParser for the XML — so this adds no dependency. That keeps the
 * licence audit trivial and keeps a large third-party parser out of a public demo.
 */

export interface SheetRows {
  rows: string[][];
  sheetName: string | null;
}

export async function readWorkbook(file: File): Promise<SheetRows> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    return { rows: parseDelimited(await file.text(), name.endsWith('.tsv') ? '\t' : ','), sheetName: null };
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    return readXlsx(await file.arrayBuffer());
  }
  if (name.endsWith('.xls')) {
    throw new Error(
      'That is the older .xls format. Open it in Excel and use Save As to make a .xlsx or a .csv, then try again.',
    );
  }
  throw new Error('Use a .xlsx or .csv export from your billing system.');
}

/* ---------------------------------------------------------------- CSV */

/** RFC-4180-ish: quoted fields, doubled quotes inside them, CR/LF inside quotes. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* --------------------------------------------------------------- XLSX */

async function readXlsx(buf: ArrayBuffer): Promise<SheetRows> {
  const entries = await unzip(buf);
  const shared = entries.get('xl/sharedStrings.xml');
  const strings = shared ? sharedStrings(shared) : [];

  // The first sheet by workbook order, which is what the user sees when they open the file.
  const wb = entries.get('xl/workbook.xml');
  let sheetName: string | null = null;
  if (wb) {
    const m = /<sheet\b[^>]*name="([^"]*)"/.exec(wb);
    if (m) sheetName = decodeXml(m[1]);
  }
  const path =
    [...entries.keys()].find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k)) ??
    [...entries.keys()].find((k) => /^xl\/worksheets\/.+\.xml$/.test(k));
  if (!path) throw new Error('That .xlsx has no worksheet in it.');
  return { rows: sheetRows(entries.get(path)!, strings), sheetName };
}

const COL = /^([A-Z]+)/;

function colIndex(ref: string): number {
  const m = COL.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRows(xml: string, strings: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const [, attrs, body] of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const [, cellAttrs, cellBody] of body.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+\d+)"/.exec(cellAttrs)?.[1] ?? '';
      const type = /t="([^"]+)"/.exec(cellAttrs)?.[1] ?? 'n';
      const at = ref ? colIndex(ref) : row.length;
      let value = '';
      if (cellBody) {
        if (type === 's') {
          const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(cellBody)?.[1] ?? '-1');
          value = strings[idx] ?? '';
        } else if (type === 'inlineStr') {
          value = [...cellBody.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');
        } else {
          value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(cellBody)?.[1] ?? '');
        }
      }
      while (row.length < at) row.push('');
      row[at] = value;
    }
    const n = Number(/r="(\d+)"/.exec(attrs)?.[1] ?? rows.length + 1);
    while (rows.length < n - 1) rows.push([]);
    rows[n - 1] = row;
  }
  return rows;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, si]) =>
    [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join(''),
  );
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/* ---------------------------------------------------------------- ZIP */

/**
 * Just enough ZIP to read an .xlsx: walk the central directory, inflate each stored or
 * deflated entry. Encryption, spanning and ZIP64 are out of scope and say so plainly.
 */
async function unzip(buf: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('That file is not a readable .xlsx (no zip directory found).');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (!/^xl\/.*\.xml$/.test(name)) continue;
    const lNameLen = view.getUint16(localAt + 26, true);
    const lExtraLen = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const chunk = bytes.subarray(start, start + compressedSize);

    if (method === 0) out.set(name, new TextDecoder().decode(chunk));
    else if (method === 8) out.set(name, new TextDecoder().decode(await inflateRaw(chunk)));
    else throw new Error('That .xlsx uses a compression method this reader does not support.');
  }
  return out;
}

async function inflateRaw(chunk: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  // Copy into a standalone buffer: a subarray view cannot be enqueued safely.
  const stream = new Blob([new Uint8Array(chunk)]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** End-of-central-directory record, scanned from the back past any trailing comment. */
function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}
