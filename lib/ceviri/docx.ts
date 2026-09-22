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

const DRAWING = /<w:drawing>[\s\S]*?<\/w:drawing>/g;
const PICT = /<w:pict(?:\s[^>]*)?>[\s\S]*?<\/w:pict>/g;
const BLIP_REL = /<a:blip\b[^>]*\br:embed="([^"]+)"/;
const VML_REL = /<v:imagedata\b[^>]*\br:id="([^"]+)"/;

/** document.xml ilişki kimliği → paketteki dosya yolu ("word/media/image1.png"). */
function relationships(files: Record<string, Uint8Array>): Map<string, string> {
  const raw = files["word/_rels/document.xml.rels"];
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const [tag] of strFromU8(raw).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target || /\bTargetMode="External"/.test(tag)) continue;
    map.set(id, decodeURIComponent(new URL(target, "file:///word/").pathname.slice(1)));
  }
  return map;
}

function imagePart(element: string, rels: Map<string, string>): string | null {
  const id = (BLIP_REL.exec(element) ?? VML_REL.exec(element))?.[1];
  return id ? (rels.get(id) ?? null) : null;
}

export type DocxMedia = { part: string; bytes: Uint8Array; order: number };

/** Gövdede çizilen görseller: her dosya bir kez, ilk göründüğü paragrafın sırasıyla. */
export function docxMedia(bytes: Uint8Array): DocxMedia[] {
  const files = unzipSync(bytes);
  const xml = documentXml(files);
  const rels = relationships(files);
  const found = new Map<string, DocxMedia>();
  let order = 0;
  PARAGRAPH.lastIndex = 0;
  let paragraph: RegExpExecArray | null;
  while ((paragraph = PARAGRAPH.exec(xml))) {
    order += 1;
    for (const [element] of paragraph[0].matchAll(new RegExp(`${DRAWING.source}|${PICT.source}`, "g"))) {
      const part = imagePart(element, rels);
      if (part && files[part] && !found.has(part)) found.set(part, { part, bytes: files[part], order });
    }
  }
  return [...found.values()];
}

/**
 * Rebuilds the .docx with translated text, touching nothing but the characters
 * inside <w:t> nodes. Untranslated segments keep their original text.
 *
 * `marks`: görsel dosyası → onun yerine yazılacak satırlar. İmza ve mühür
 * görseli çeviride kopyalanmaz (müşteri kuralı); aynı koşunun içinde etiket
 * metniyle değiştirilir. Logo gibi diğer görseller olduğu gibi kalır.
 */
export function rebuildDocx(
  bytes: Uint8Array,
  translations: Map<string, string>,
  marks: Map<string, string[]> = new Map(),
): Uint8Array {
  const files = unzipSync(bytes);
  const xml = documentXml(files);
  const rels = relationships(files);

  let order = 0;
  const translated = xml.replace(PARAGRAPH, (body) => {
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

  // Etiketler metin çevirisinden sonra konur: çeviri bir paragrafın ilk
  // <w:t>'sini doldurup gerisini boşaltır, etiketi silmesin.
  const label = (element: string) => {
    const part = imagePart(element, rels);
    const lines = part ? marks.get(part) : undefined;
    if (!lines?.length) return element;
    return lines.map((text) => `<w:t xml:space="preserve">${encodeXml(text)}</w:t>`).join("<w:br/>");
  };
  const rebuilt = marks.size ? translated.replace(DRAWING, label).replace(PICT, label) : translated;

  files["word/document.xml"] = strToU8(rebuilt);
  return zipSync(files);
}
