import { unzipSync, strFromU8 } from "fflate";

export type TermEntry = { lang: string; text: string; notes: string | null; example: string | null };
export type TermRow = {
  forbidden: boolean;
  domain: string | null;
  subdomain: string | null;
  definition: string | null;
  entries: TermEntry[];
};

const FIXED_COLUMNS = 4; // Forbidden, Domain, Subdomain, Definition
const LOCALE_STRIDE = 3; // <locale>, Notes, Example of use

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** "AB12" -> 27. Letters are base-26 with no zero digit. */
export function columnIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/) ?? [""])[0];
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const raw = files["xl/sharedStrings.xml"];
  if (!raw) return [];
  const xml = strFromU8(raw);
  return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((si) =>
    (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
      .map((t) => decode(t.replace(/<[^>]+>/g, ""))).join(""));
}

type SheetRow = { number: number; cells: string[] };

function sheetRows(xml: string, shared: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  const rowXmls = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? [];
  rowXmls.forEach((rowXml, i) => {
    const rowAttr = (rowXml.match(/^<row\b[^>]*\br="(\d+)"/) ?? [])[1];
    const number = rowAttr ? Number(rowAttr) : i + 1;
    const cells: string[] = [];
    for (const cell of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = (cell.match(/\br="([A-Z]+\d+)"/) ?? [])[1];
      if (!ref) continue;
      const type = (cell.match(/\bt="([^"]*)"/) ?? [])[1];
      const inline = cell.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
      const value = cell.match(/<v>([\s\S]*?)<\/v>/);
      let text = "";
      if (inline) text = decode(inline[1]);
      else if (value) text = type === "s" ? (shared[Number(value[1])] ?? "") : decode(value[1]);
      cells[columnIndex(ref)] = text;
    }
    rows.push({ number, cells });
  });
  return rows;
}

function cell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function orNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Interprets the Forbidden column. Excel writes native booleans (t="b", <v>1</v>/<v>0</v>)
 * once someone edits the termbase there, so this must recognise those alongside the literal
 * "true"/"false" text the customer's export currently uses. Anything else throws rather than
 * silently defaulting to "not forbidden" — a forbidden term must never slip through as permitted.
 */
export function parseForbidden(value: string, rowNumber: number): boolean {
  const normalised = value.trim().toLowerCase();
  if (normalised === "true" || normalised === "1") return true;
  if (normalised === "false" || normalised === "0" || normalised === "") return false;
  throw new Error(`Unrecognised Forbidden value "${value}" in row ${rowNumber} — expected true/false/1/0 or empty.`);
}

export function parseTermbase(file: Uint8Array): { locales: string[]; rows: TermRow[] } {
  const files = unzipSync(file);
  const sheetKey = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetKey) return { locales: [], rows: [] };

  const raw = sheetRows(strFromU8(files[sheetKey]), sharedStrings(files));
  if (raw.length === 0) return { locales: [], rows: [] };

  const header = raw[0].cells;
  const locales: string[] = [];
  for (let c = FIXED_COLUMNS; c < header.length; c += LOCALE_STRIDE) {
    const name = cell(header, c);
    if (name) locales.push(name);
  }

  const rows: TermRow[] = [];
  for (const row of raw.slice(1)) {
    const entries: TermEntry[] = [];
    locales.forEach((lang, i) => {
      const base = FIXED_COLUMNS + i * LOCALE_STRIDE;
      const text = cell(row.cells, base);
      if (!text) return;
      entries.push({ lang, text, notes: orNull(cell(row.cells, base + 1)), example: orNull(cell(row.cells, base + 2)) });
    });
    if (entries.length === 0) continue;
    rows.push({
      forbidden: parseForbidden(cell(row.cells, 0), row.number),
      domain: orNull(cell(row.cells, 1)),
      subdomain: orNull(cell(row.cells, 2)),
      definition: orNull(cell(row.cells, 3)),
      entries,
    });
  }
  return { locales, rows };
}
