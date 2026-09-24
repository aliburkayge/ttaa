import { isMark, type MarkKind } from "./marks";

/**
 * OCR çıktısından belge yapısı (sayfa → başlık / paragraf / tablo / görsel).
 *
 * Saf fonksiyonlar: ağ çağrısı yok, bu yüzden gerçek bir Mistral yanıtıyla
 * test edilebiliyor. Hem çevrilecek segmentleri hem de çeviriden Word
 * üretirken kullanılacak düzeni buradan çıkarıyoruz.
 */

/** Bu güvenin altındaki satırlar inceleyene "aslıyla karşılaştırın" diye gösterilir. */
export const LOW_CONFIDENCE = 0.7;

/**
 * Görselin içinden ikinci OCR geçişiyle okunan metin bu eşiğin altındaysa
 * alınmaz. Ölçüm: BASF DELAN SC belgesinde mühürlü bloktaki basılı isim
 * %89 ile doğru okundu; imza karalaması ise %49 ile "Schulz" diye okundu —
 * gerçek isim "Schmitz". İmzadan isim uydurmak resmi evrakta kabul edilemez.
 */
export const IMAGE_TEXT_MIN_CONFIDENCE = 0.8;

export type ImageKind =
  | "signature"
  | "stamp"
  | "signature_stamp"
  | "logo"
  | "photo"
  | "barcode"
  | "text"
  | "unknown";

export type OcrLine = {
  id: string;
  text: string;
  /** 0-1; null ise sağlayıcı güven vermedi. */
  confidence: number | null;
  /** İnceleme ekranında gösterilecek OCR uyarısı; çeviriden bağımsızdır. */
  ocrWarning: string | null;
};

/** OCR'ın koordinat düzleminde bir kutu (sayfa pikseli, sol üst başlangıç). */
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Bloğun sayfadaki yeri; çeviri orijinal sayfada tam bu konuma yazılır. */
export type Frame = { box: Box; pageWidth: number; pageHeight: number };

export type LayoutBlock =
  | {
      kind: "paragraph";
      role: "header" | "footer" | "title" | "text";
      page: number;
      lines: OcrLine[];
      frame?: Frame;
    }
  | {
      kind: "table";
      page: number;
      rows: Array<Array<{ colspan: number; lines: OcrLine[] }>>;
      frame?: Frame;
    }
  | {
      kind: "image";
      page: number;
      image: ImageKind;
      /** Görselin içindeki basılı metin (ör. mühürlü bloktaki imzacı adı). */
      lines: OcrLine[];
      frame?: Frame;
    };

export type LayoutSegment = {
  id: string;
  text: string;
  kind: "paragraph" | "table-cell";
  order: number;
  page: number;
  confidence: number | null;
  ocrWarning: string | null;
  /** Satır bir imza/mühür bölgesinin içinden okunduysa: çıktıda etiketle birlikte yazılır. */
  mark: MarkKind | null;
  /** OCR bloğunun sırası: aynı paragrafın satırları cümle olarak birlikte çevrilir (bkz. units.ts). */
  block: number;
};

// ---------- Mistral yanıt tipleri (yalnızca kullandığımız alanlar) ----------

export type MistralBlock = {
  type: string;
  content?: string | null;
  top_left_x?: number;
  top_left_y?: number;
  bottom_right_x?: number;
  bottom_right_y?: number;
  confidence_scores?: {
    average_content_confidence_score?: number | null;
    minimum_content_confidence_score?: number | null;
  } | null;
};

export type MistralPage = {
  index: number;
  blocks?: MistralBlock[] | null;
  images?: Array<{
    id: string;
    top_left_x?: number;
    top_left_y?: number;
    bottom_right_x?: number;
    bottom_right_y?: number;
    image_base64?: string | null;
  }> | null;
  dimensions?: { dpi?: number; width?: number; height?: number } | null;
};

export type MistralResponse = { pages?: MistralPage[] | null; model?: string };

/** İkinci geçişin sonucu: görselin türü ve içinden okunan satırlar. */
export type ImageInsight = { kind: ImageKind; lines: Array<{ text: string; confidence: number | null }> };

// ---------- yardımcılar ----------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeHtml(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

/** Markdown başlık işaretlerini ve fazla boşluğu temizler; satırlara böler. */
export function textLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#{1,6}\s+/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/**
 * Mistral'in HTML tablosunu satır/hücre dizisine çevirir. Hücre içindeki
 * `<br/>` ayrı satır olur: "0.25 L: 30 g bottle<br/>0.5 L: 45 g bottle"
 * iki ayrı segment olarak çevrilir ve Word'de yine alt alta yazılır.
 */
export function parseTableHtml(html: string): Array<Array<{ colspan: number; lines: string[] }>> {
  const rows: Array<Array<{ colspan: number; lines: string[] }>> = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells: Array<{ colspan: number; lines: string[] }> = [];
    for (const cell of row.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const span = /colspan\s*=\s*["']?(\d+)/i.exec(cell[2]);
      const lines = cell[3]
        .split(/<br\s*\/?>/i)
        .map((part) => decodeHtml(part.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
        .filter((part) => part.length > 0);
      cells.push({ colspan: span ? Math.max(1, Number(span[1])) : 1, lines });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function percent(value: number): string {
  return `%${Math.round(value * 100)}`;
}

function roleFor(type: string): "header" | "footer" | "title" | "text" {
  if (type === "header") return "header";
  if (type === "footer") return "footer";
  if (type === "title" || type === "caption") return "title";
  return "text";
}

function imageRef(content: string | null | undefined): string | null {
  const match = /!\[[^\]]*\]\(([^)]+)\)/.exec(content ?? "");
  return match ? match[1] : null;
}

/** Görsel ikinci geçişte okunacaksa anahtar: "sayfa:görsel-id". */
export function imageKey(page: number, id: string): string {
  return `${page}:${id}`;
}

const SIGNATURE_LIKE: ReadonlySet<ImageKind> = new Set(["signature", "stamp", "signature_stamp"]);

/**
 * İmza ile altındaki isim arasındaki en büyük boşluk (sayfa pikseli). Ölçüm:
 * DELAN SC 2. sayfada imza 675'te bitiyor, "Dirk Schmitz" 677'de başlıyor;
 * yandaki sütundaki mühürlü blok 785'te bitiyor ve altındaki ilk satır
 * ("Postal Address", 814) bir isim değil, 29 piksel aşağıda.
 */
const SIGNATURE_NAME_GAP = 20;

type Placed = { block: LayoutBlock; box: Box | null };

function boxOf(source: {
  top_left_x?: number;
  top_left_y?: number;
  bottom_right_x?: number;
  bottom_right_y?: number;
}): Box | null {
  const { top_left_x: x0, top_left_y: y0, bottom_right_x: x1, bottom_right_y: y1 } = source;
  if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Yan yana iki imzacı OCR'ın okuma sırasında karışır: sol sütunun imzası,
 * sağ sütunun mühürlü bloğu, sonra sol sütunun ismi. Düz sırayla yazılınca
 * bir imza başkasının adının üstüne düşer. Bir imza görselinin hemen altında
 * aynı sütunda bir satır varsa imza o satırın hemen önüne taşınır.
 */
function keepSignaturesWithNames(items: Placed[]): Placed[] {
  const result = [...items];
  for (const item of items) {
    const { block, box } = item;
    if (block.kind !== "image" || !SIGNATURE_LIKE.has(block.image) || !box) continue;

    let anchor: Placed | null = null;
    let bestGap = Infinity;
    for (const other of result) {
      if (other.block.kind !== "paragraph" || !other.box) continue;
      const gap = other.box.y0 - box.y1;
      const overlaps = other.box.x0 < box.x1 && other.box.x1 > box.x0;
      if (overlaps && gap >= -2 && gap <= SIGNATURE_NAME_GAP && gap < bestGap) {
        anchor = other;
        bestGap = gap;
      }
    }
    if (!anchor) continue;

    const from = result.indexOf(item);
    const to = result.indexOf(anchor);
    if (to <= from) continue; // isim zaten imzadan önce geliyorsa dokunma
    result.splice(from, 1);
    result.splice(result.indexOf(anchor), 0, item);
  }
  return result;
}

/**
 * Mistral yanıtından sayfa sıralı düzen üretir.
 *
 * `insights` her görsel için türü ve içinden okunan metni taşır; bu bilgi
 * ikinci bir ağ çağrısı gerektirdiği için dışarıdan verilir.
 */
export function layoutFromMistral(
  response: MistralResponse,
  insights: Map<string, ImageInsight> = new Map(),
): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let counter = 0;
  const nextId = () => `o${++counter}`;

  for (const page of response.pages ?? []) {
    const pageNo = page.index + 1;
    const pageWidth = page.dimensions?.width ?? 0;
    const pageHeight = page.dimensions?.height ?? 0;
    const placed: Placed[] = [];

    for (const block of page.blocks ?? []) {
      const min = block.confidence_scores?.minimum_content_confidence_score ?? null;
      const avg = block.confidence_scores?.average_content_confidence_score ?? null;

      if (block.type === "image") {
        const id = imageRef(block.content);
        const image = id ? page.images?.find((candidate) => candidate.id === id) : undefined;
        const insight = id ? insights.get(imageKey(page.index, id)) : undefined;
        const kind: ImageKind = insight?.kind ?? "unknown";
        const x0 = image?.top_left_x ?? block.top_left_x ?? 0;
        const y0 = image?.top_left_y ?? block.top_left_y ?? 0;
        const x1 = image?.bottom_right_x ?? block.bottom_right_x ?? x0;
        const y1 = image?.bottom_right_y ?? block.bottom_right_y ?? y0;

        const lines: OcrLine[] = [];
        for (const line of insight?.lines ?? []) {
          if (line.confidence !== null && line.confidence < IMAGE_TEXT_MIN_CONFIDENCE) continue;
          for (const text of textLines(line.text)) {
            lines.push({
              id: nextId(),
              text,
              confidence: line.confidence,
              ocrWarning:
                "Bu metin bir görselin (imza/mühür alanı) içinden okundu. Aslıyla karşılaştırın.",
            });
          }
        }

        placed.push({ block: { kind: "image", page: pageNo, image: kind, lines }, box: { x0, y0, x1, y1 } });
        continue;
      }

      if (block.type === "table") {
        const lowTable = avg !== null && avg < 0.85;
        const rows = parseTableHtml(block.content ?? "").map((row) =>
          row.map((cell) => ({
            colspan: cell.colspan,
            lines: cell.lines.map((text) => ({
              id: nextId(),
              text,
              confidence: avg,
              ocrWarning: lowTable
                ? `OCR bu tabloyu okurken emin değildi (ortalama güven ${percent(avg)}). Aslıyla karşılaştırın.`
                : null,
            })),
          })),
        );
        if (rows.length) placed.push({ block: { kind: "table", page: pageNo, rows }, box: boxOf(block) });
        continue;
      }

      const lines = textLines(block.content ?? "").map((text) => ({
        id: nextId(),
        text,
        confidence: min,
        ocrWarning:
          min !== null && min < LOW_CONFIDENCE
            ? `OCR bu satırı okurken emin değildi (en düşük güven ${percent(min)}). Aslıyla karşılaştırın.`
            : null,
      }));
      if (lines.length) {
        placed.push({
          block: { kind: "paragraph", role: roleFor(block.type), page: pageNo, lines },
          box: boxOf(block),
        });
      }
    }

    for (const { block, box } of keepSignaturesWithNames(placed)) {
      blocks.push(box && pageWidth && pageHeight ? { ...block, frame: { box, pageWidth, pageHeight } } : block);
    }
  }

  return blocks;
}

/** Düzenden, okunma sırasıyla çevrilecek segmentler. */
export function layoutSegments(blocks: LayoutBlock[]): LayoutSegment[] {
  const segments: LayoutSegment[] = [];
  const push = (line: OcrLine, kind: LayoutSegment["kind"], page: number, block: number, mark: MarkKind | null = null) =>
    segments.push({
      id: line.id,
      text: line.text,
      kind,
      order: segments.length + 1,
      page,
      confidence: line.confidence,
      ocrWarning: line.ocrWarning,
      mark,
      block,
    });

  blocks.forEach((block, index) => {
    if (block.kind === "table") {
      for (const row of block.rows) for (const cell of row) for (const line of cell.lines) push(line, "table-cell", block.page, index);
    } else {
      const mark = block.kind === "image" && isMark(block.image) ? block.image : null;
      for (const line of block.lines) push(line, "paragraph", block.page, index, mark);
    }
  });
  return segments;
}

export function layoutStats(blocks: LayoutBlock[], pages: number | null) {
  const segments = layoutSegments(blocks);
  return {
    paragraphs: segments.filter((segment) => segment.kind === "paragraph").length,
    tableCells: segments.filter((segment) => segment.kind === "table-cell").length,
    tables: blocks.filter((block) => block.kind === "table").length,
    images: blocks.filter((block) => block.kind === "image").length,
    signatures: blocks.filter((block) => block.kind === "image" && (block.image === "signature" || block.image === "signature_stamp")).length,
    stamps: blocks.filter((block) => block.kind === "image" && (block.image === "stamp" || block.image === "signature_stamp")).length,
    words: segments.reduce((total, segment) => total + (segment.text.match(/\S+/g) ?? []).length, 0),
    pages: pages ?? 0,
  };
}
