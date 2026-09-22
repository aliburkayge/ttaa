# İmza ve mühür etiketi — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Çeviride imza ve mühür kopyalanmaz; yerlerine hedef dilde `[İMZA]` / `[MÜHÜR: …]` etiketi yazılır (PDF, görsel, Word).

**Architecture:** Saf bir `marks.ts` etiket metnini üretir. Taranmış belgede `planOverlay` her imza/mühür bloğu için bölgeyi silen ve etiketi yazan bir işaret öğesi üretir; `renderOverlay` işaretleri önce çizer. Word'de görseller yüklemede sınıflandırılır, `rebuildDocx` imza/mühür görselini etiket metniyle değiştirir.

**Tech Stack:** TypeScript, Next 16 route handlers, pdf-lib, pdf.js, sharp, fflate, node:test + tsx.

**Spec:** `docs/superpowers/specs/2026-09-22-imza-muhur-etiketi-design.md`

## Global Constraints

- Etiket büyük harf, köşeli parantez, hedef dilde; tablo spec'teki gibi. Bilinmeyen dil → İngilizce.
- Mühür yazısı: `[MÜHÜR: a, b]`; yazı yoksa `[MÜHÜR]`.
- İmza: `[İMZA]` + basılı satırlar alt alta. İç içe: `[İMZA] [MÜHÜR]` + basılı satırlar alt alta.
- Logo, fotoğraf, barkod, tablo, çizgi değişmez. `unknown` görsel silinmez.
- `PLAN_VERSION` 4.
- Testler: `node --import tsx --test tests/<dosya>.test.ts`.

---

### Task 1: Etiket metni (`lib/ceviri/marks.ts`)

**Files:** Create `lib/ceviri/marks.ts`, Test `tests/ceviri-marks.test.ts`

**Produces:** `type MarkKind = "signature" | "stamp" | "signature_stamp"`, `isMark(kind): kind is MarkKind`, `markLabels(targetLang): { signature: string; stamp: string }`, `markText(kind, targetLang, lines: string[]): string[]`, `markNote(kind, targetLang): string`.

- [ ] Test yaz: tr etiketleri; mühür yazısı parantez içinde `, ` ile; imza altına basılı satırlar; iç içe `[İMZA] [MÜHÜR]`; en/de/ru/es/it/el/pl; `ja-JP` → İngilizce; `isMark`.
- [ ] Çalıştır, FAIL.
- [ ] `LABELS` tablosu + fonksiyonlar (spec tablosu birebir).
- [ ] Çalıştır, PASS. Commit.

### Task 2: Segmentte işaret bilgisi ve sayılar (`ocr-layout.ts`, `ocr.ts`, yükleme rotası)

**Files:** Modify `lib/ceviri/ocr-layout.ts` (`LayoutSegment`, `layoutSegments`, `layoutStats`), `lib/ceviri/ocr.ts` (`inspectImage` dışa aç, OCR hatasında türü koru), `app/api/ceviri/documents/route.ts` (segmentte `mark`). Test `tests/ceviri-ocr-layout.test.ts`.

**Produces:** `LayoutSegment.mark: MarkKind | null`; `layoutStats(...).signatures`, `.stamps`; `export async function inspectImage(dataUrl: string): Promise<ImageInsight>`.

- [ ] Test: imza+mühür bloğunun satırları `mark: "signature_stamp"`, paragraf satırları `mark: null`; `layoutStats` imza/mühür sayar (`signature_stamp` ikisine de).
- [ ] FAIL → uygula → PASS. Commit.

### Task 3: Overlay işaret öğesi (`pdf-overlay.ts`)

**Files:** Modify `lib/ceviri/pdf-overlay.ts`; Test `tests/ceviri-pdf-overlay.test.ts`.

**Consumes:** `isMark`, `markText`, `MarkKind` (Task 1).
**Produces:** `OverlayItem.mark?: MarkKind`, `OverlayItem.redraw?: boolean`, `export function subtractRects(rect: Rect, holes: Rect[]): Rect[]`, `renderOverlay(..., { targetLang?: string })`, `PLAN_VERSION = 4`.

- [ ] Testleri güncelle/ekle:
  - `subtractRects`: delik yok → aynı; ortada delik → 4 parça; dışta delik → aynı.
  - `BLOCKS` artık `unplaced: []` ve imza+mühür bloğu için `mark: "signature_stamp"` öğesi, `lineIds` = `[stampText]`, `erase` bölgeyi kaplar.
  - `STAMP_BLOCKS`: tek işaret öğesi, satırlar ayrı öğe değil; çizimden sonra mavi halka pikseli kağıt rengi (renderPdfPage ile örnekle).
  - "hiçbir şey değişmezse" testi işaretsiz bloklarla (`TEXT_BLOCKS`).
  - İşaret bölgesine değen öğe `redraw: true`.
- [ ] FAIL.
- [ ] Uygula: `onPage` filtresi işaret bloklarını da alır; görsel dalı işaret için `marks` listesine ekler (bölge `grow(box, 2, 2)`, kağıt `survey(...).paper`, mürekkep `frame.textColor`); sayfa sonunda yerleşemeyen blokların kutuları `subtractRects` ile silmeden çıkarılır ve uyarı yazılır; öğeler kurulduktan sonra işaret öğeleri (punto: sayfadaki öğelerin ortancası, yoksa 10; ortalı; aile: belgenin ailesi) başa eklenir, değen öğelere `redraw`.
- [ ] `renderOverlay`: işaretler önce; işaret için içerik `markText(...)`, dikey ortalı; işaret olmayan öğe `changed || redraw` ise çizilir.
- [ ] Başlık yorumunu yeni kurala göre güncelle.
- [ ] PASS (tüm overlay testleri). Commit.

### Task 4: Teslim hattı (`deliver.ts`, `image-doc.ts`, indirme rotası)

**Files:** Modify `lib/ceviri/deliver.ts`, `lib/ceviri/image-doc.ts`, `app/api/ceviri/documents/[id]/download/route.ts`.

- [ ] `StoredDocument.target_lang?: string`; `renderOverlay(..., { targetLang })`; `overlayImage(original, plan, texts, targetLang?)`; rota `target_lang` seçer.
- [ ] Typecheck (`npx tsc --noEmit -p .`), commit.

### Task 5: Word (`docx.ts`, `docx-marks.ts`, teslim, yükleme)

**Files:** Modify `lib/ceviri/docx.ts` (`docxMedia`, `rebuildDocx(bytes, translations, marks?)`); Create `lib/ceviri/docx-marks.ts`; Modify `deliver.ts`, `app/api/ceviri/documents/route.ts`; Test `tests/ceviri-docx.test.ts`.

**Produces:** `docxMedia(bytes): Array<{ part: string; bytes: Uint8Array; order: number }>`; `rebuildDocx(bytes, translations, marks: Map<string, string[]> = new Map())`; `type DocxLayout = { version: "docx-1"; marks: Array<{ part: string; kind: MarkKind; lineIds: string[] }> }`; `findDocxMarks(bytes, inspect?)`.

- [ ] Test: `r:embed` ile imza görseli + logo; `docxMedia` ikisini sırayla verir; `findDocxMarks` (sahte `inspect`) imzayı işaretler, logoyu değil, mühür yazısını segment yapar; `rebuildDocx` imza çizimini `[İMZA]` metniyle değiştirir, logo çizimi kalır, metin çevirisi yazılır; `w:pict`/`v:imagedata` de değişir.
- [ ] FAIL → uygula → PASS.
- [ ] `deliver`: Word için düzen yoksa `findDocxMarks` (satırlar boş) ve `refreshed`; etiketler `markText`.
- [ ] Yükleme: Word dalında `findDocxMarks`, segmentlere ekle, `layout` kaydet, `stats.signatures/stamps`.
- [ ] Commit.

### Task 6: Arayüz notları (`lingua.tsx`)

- [ ] `Segment.mark`, `Doc.stats.signatures/stamps`; kaynak sütununda `markNote`; kartta sayı; "imza ve mühür olduğu gibi kalır" metni yeni kurala göre.
- [ ] Tarayıcıda kontrol. Commit.

### Task 7: Uçtan uca doğrulama

- [ ] Scratchpad betiği: BASF belgesini Supabase'den al, `deliver` çalıştır, sayfaları PNG'ye render et, bak.
- [ ] Tüm ceviri testleri: `node --import tsx --test tests/ceviri-*.test.ts`.
