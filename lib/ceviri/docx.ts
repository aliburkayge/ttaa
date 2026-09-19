import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

/**
 * A translatable unit of a .docx: one paragraph's visible text.
 *
 * Word splits a single sentence across several <w:r> runs whenever formatting
 * changes mid-sentence, so a segment is assembled from every <w:t> inside one
 * <w:p>. Writing a translation back means filling the first <w:t> and emptying
 * the rest, which leaves every run property, table cell, image and style byte
 * exactly where Word put it.
 */
export type DocxSegment = {
  id: string;
  text: string;
  kind: "paragraph" | "table-cell";
  /** 1-based position of the paragraph inside document.xml. */
  order: number;
};

export type DocxDocument = {
  segments: DocxSegment[];
  /** Counts for the UI; images and tables are preserved, never translated. */
  stats: { paragraphs: number; tableCells: number; tables: number; images: number; words: number };
};

const PARAGRAPH = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
const TEXT_NODE = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;

function decode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

export function encodeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function documentXml(files: Record<string, Uint8Array>): string {
  const raw = files["word/document.xml"];
  if (!raw) throw new Error("Bu dosya bir Word belgesi değil (word/document.xml yok).");
  return strFromU8(raw);
}

/** Marks which paragraphs sit inside a table, by character offset. */
function tableRanges(xml: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const open = /<w:tbl(?:\s[^>]*)?>/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml))) {
    const end = xml.indexOf("</w:tbl>", match.index);
    if (end !== -1) ranges.push([match.index, end]);
  }
  return ranges;
}

export function parseDocx(bytes: Uint8Array): DocxDocument {
  const files = unzipSync(bytes);
  const xml = documentXml(files);
  const ranges = tableRanges(xml);
  const inTable = (offset: number) => ranges.some(([from, to]) => offset >= from && offset <= to);

  const segments: DocxSegment[] = [];
  let paragraphs = 0;
  let tableCells = 0;
  let order = 0;

  PARAGRAPH.lastIndex = 0;
  let paragraph: RegExpExecArray | null;
  while ((paragraph = PARAGRAPH.exec(xml))) {
    order += 1;
    const body = paragraph[0];
    const parts: string[] = [];
    TEXT_NODE.lastIndex = 0;
    let node: RegExpExecArray | null;
    while ((node = TEXT_NODE.exec(body))) parts.push(decode(node[2]));
    const text = parts.join("").trim();
    if (!text) continue;

    const kind = inTable(paragraph.index) ? "table-cell" : "paragraph";
    if (kind === "table-cell") tableCells += 1;
    else paragraphs += 1;
    segments.push({ id: `p${order}`, text, kind, order });
  }

  const tables = (xml.match(/<w:tbl(?:\s[^>]*)?>/g) ?? []).length;
  const images = Object.keys(files).filter((name) => name.startsWith("word/media/")).length;
  const words = segments.reduce((total, s) => total + (s.text.match(/\S+/g) ?? []).length, 0);

  return { segments, stats: { paragraphs, tableCells, tables, images, words } };
}

/**
 * Rebuilds the .docx with translated text, touching nothing but the characters
 * inside <w:t> nodes. Untranslated segments keep their original text.
 */
export function rebuildDocx(bytes: Uint8Array, translations: Map<string, string>): Uint8Array {
  const files = unzipSync(bytes);
  const xml = documentXml(files);

  let order = 0;
  const rebuilt = xml.replace(PARAGRAPH, (body) => {
    order += 1;
    const replacement = translations.get(`p${order}`);
    if (replacement === undefined) return body;

    let first = true;
    TEXT_NODE.lastIndex = 0;
    return body.replace(TEXT_NODE, (_whole, open: string, _text: string, close: string) => {
      if (!first) return `${open}${close}`;
      first = false;
      // xml:space="preserve" keeps leading and trailing spaces from collapsing.
      const tag = open.includes("xml:space") ? open : open.replace(/>$/, ' xml:space="preserve">');
      return `${tag}${encodeXml(replacement)}${close}`;
    });
  });

  files["word/document.xml"] = strToU8(rebuilt);
  return zipSync(files);
}
