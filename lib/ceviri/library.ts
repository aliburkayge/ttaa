/**
 * Kütüphane: yüklenen bütün belgeler, en yeniden eskiye. Ana sayfa son 5
 * belgeyi, kütüphane sayfası hepsini 30'ar 30'ar gösterir; dosya adında arama
 * ve türe göre süzme sunucuda yapılır.
 */

export type FileKind = "pdf" | "word" | "image";

export type LibraryQuery = { q: string; kind: FileKind | "all"; offset: number; limit: number };

export type LibraryItem = {
  id: string;
  filename: string;
  created_at: string;
  source_lang: string;
  target_lang: string;
  kind: FileKind;
  total: number;
  translated: number;
  pages: number | null;
  /** Word belgesinde önizlemede gösterilecek ilk satırlar (görüntüsü çizilemiyor). */
  preview: string[];
};

export const PAGE_SIZE = 30;
const MAX_LIMIT = 60;

export function fileKind(filename: string): FileKind {
  const name = filename.toLowerCase();
  if (name.endsWith(".docx")) return "word";
  if (name.endsWith(".pdf")) return "pdf";
  return "image";
}

/** Türe göre süzmede dosya adı kalıpları (SQL ILIKE). */
export const KIND_PATTERNS: Record<FileKind, string[]> = {
  pdf: ["%.pdf"],
  word: ["%.docx"],
  image: ["%.jpg", "%.jpeg", "%.png", "%.webp", "%.tif", "%.tiff"],
};

export function parseLibraryQuery(params: URLSearchParams): LibraryQuery {
  const number = (name: string, fallback: number) => {
    const value = Number.parseInt(params.get(name) ?? "", 10);
    return Number.isFinite(value) ? value : fallback;
  };
  const kind = params.get("kind");
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    kind: kind === "pdf" || kind === "word" || kind === "image" ? kind : "all",
    offset: Math.max(0, number("offset", 0)),
    limit: Math.min(MAX_LIMIT, Math.max(1, number("limit", PAGE_SIZE))),
  };
}

/** Aranan metindeki %, _ ve \ harfiyen aranır (ILIKE joker karakterleri). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

type StoredRow = {
  id: string;
  filename: string;
  created_at: string;
  source_lang: string;
  target_lang: string;
  stats?: { pages?: number } | null;
  segments?: Array<{ text?: string; translation: string | null }> | null;
};

export function toLibraryItem(row: StoredRow): LibraryItem {
  const segments = row.segments ?? [];
  const kind = fileKind(row.filename);
  return {
    id: row.id,
    filename: row.filename,
    created_at: row.created_at,
    source_lang: row.source_lang,
    target_lang: row.target_lang,
    kind,
    total: segments.length,
    translated: segments.filter((segment) => segment.translation !== null).length,
    pages: typeof row.stats?.pages === "number" ? row.stats.pages : null,
    preview:
      kind === "word"
        ? segments
            .map((segment) => (segment.text ?? "").trim())
            .filter(Boolean)
            .slice(0, 3)
            .map((text) => text.slice(0, 160))
        : [],
  };
}

export type DateGroup = "Bugün" | "Dün" | "Bu hafta" | "Bu ay" | "Daha eski";

/** Kütüphanede başlıklar: belgenin yüklendiği gün, yerel saate göre. */
export function dateGroup(iso: string, now: Date): DateGroup {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const when = new Date(iso);
  const days = Math.round((day(now) - day(when)) / 86_400_000);
  if (days <= 0) return "Bugün";
  if (days === 1) return "Dün";
  if (days < 7) return "Bu hafta";
  if (when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth()) return "Bu ay";
  return "Daha eski";
}

const WEEKDAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Kartta "ne zaman": bugün saat, dün, bu hafta gün adı, daha eskisi tarih. */
export function whenLabel(iso: string, now: Date): string {
  const when = new Date(iso);
  const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const group = dateGroup(iso, now);
  if (group === "Bugün") return time;
  if (group === "Dün") return `Dün ${time}`;
  if (group === "Bu hafta") return `${WEEKDAYS[when.getDay()]} ${time}`;
  const date = `${when.getDate()} ${MONTHS[when.getMonth()]}`;
  return when.getFullYear() === now.getFullYear() ? date : `${date} ${when.getFullYear()}`;
}
