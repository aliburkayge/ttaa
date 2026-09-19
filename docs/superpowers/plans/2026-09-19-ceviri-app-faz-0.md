# Çeviri APP — Faz 0 (Bilgi Tabanı) Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 136.745 TMX segmentini ve ~525 terimi ayrı bir Supabase projesine tekilleştirerek aktarmak ve sorgulanabilir hale getirmek.

**Architecture:** Saf ayrıştırma katmanı (normalizasyon, TMX, xlsx) hiçbir dış servise bağlı değildir ve önce yazılır. Depolama katmanı ayrı bir Supabase projesine yazar; birebir eşleşme hash ile, bulanık eşleşme `pg_trgm` trigram benzerliğiyle yapılır. Terimler katmanlı çözümlenir (genel → sektör → müşteri).

**Tech Stack:** TypeScript, Node 22 test runner (`node:test`), `tsx`, `@supabase/supabase-js`, `fflate` (xlsx açma), PostgreSQL `pg_trgm`.

**Spec:** `docs/superpowers/specs/2026-09-19-ceviri-app-design.md`

## Global Constraints

- Node `>=22.13.0` (package.json `engines`).
- Test dosyaları `tests/` altında, `node:test` + `node:assert/strict` kullanır, göreli importlarda **`.ts` uzantısı yazılır** (örn. `from "../lib/ceviri/normalize.ts"`).
- Testler `node --import tsx --test <dosya>` ile çalışır.
- Yeni kod `lib/ceviri/` altında toplanır; mevcut `lib/*.ts` dosyalarına dokunulmaz.
- Migrasyonlar `supabase/ceviri/migrations/` altında ham SQL'dir. Mevcut `supabase/migrations/` **farklı bir Supabase projesine** aittir, karıştırılmaz.
- Tüm tablolarda RLS açılır ve `anon`, `authenticated` rollerinden tüm yetkiler geri alınır. Erişim yalnızca service-role ile sunucu tarafındandır.
- Ortam değişkeni önekleri: `CEVIRI_SUPABASE_URL`, `CEVIRI_SUPABASE_SERVICE_ROLE_KEY`. Mevcut `NEXT_PUBLIC_SUPABASE_*` değişkenleri blog projesine aittir, kullanılmaz.
- Normalizasyon **dile duyarlıdır**: Türkçe metinde `I→ı`, `İ→i`; İngilizce metinde `I→i`. Tek bir global `toLowerCase()` kullanılmaz.
- Yer tutucu standardı büyük harftir: `[İMZA]`, `[MÜHÜR]`, `[KAŞE]`, `[MÜHÜR/KAŞE]`, `[LOGO]`, `[BARKOD]`.

## Spec'ten sapma (bilinçli)

Spec 5.3'te `tm_segments.project_name` tekil `text` olarak yazılmıştı. Tekilleştirme sırasında "proje etiketleri toplanır" gereksinimini karşılamak için bu alan **`project_names text[]`** olarak uygulanır. Aynı kaynak/hedef çifti farklı projelerden geldiğinde etiketler birleştirilir.

## Görev bağımlılıkları

Görev 1-3 **hiçbir dış servise ihtiyaç duymaz** — Supabase projesi hazır olmadan başlanabilir.
Görev 4'ten itibaren `CEVIRI_SUPABASE_URL` ve `CEVIRI_SUPABASE_SERVICE_ROLE_KEY` gereklidir.

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `lib/ceviri/normalize.ts` | Dile duyarlı küçük harfe çevirme, boşluk sadeleştirme, hash |
| `lib/ceviri/tmx.ts` | TMX akış ayrıştırıcısı (51 MB dosyayı belleğe almadan) |
| `lib/ceviri/termbase.ts` | Terminoloji xlsx ayrıştırıcısı |
| `lib/ceviri/supabase.ts` | Çeviri projesine ait Supabase istemcisi |
| `lib/ceviri/tm-store.ts` | TM yazma (tekilleştirmeli) ve arama |
| `lib/ceviri/term-store.ts` | Terim yazma ve katmanlı çözümleme |
| `lib/ceviri/search-request.ts` | Arama isteği doğrulaması (saf, Next'e bağımsız) |
| `scripts/ceviri-import-tmx.ts` | TMX içe aktarma komutu |
| `scripts/ceviri-import-terms.ts` | Terminoloji içe aktarma komutu |
| `supabase/ceviri/migrations/*.sql` | Şema |
| `app/api/ceviri/search/route.ts` | Arama uç noktası |
| `app/ceviri-app/arama/page.tsx` | Arama arayüzü |

---

### Task 1: Dile duyarlı normalizasyon

**Files:**
- Create: `lib/ceviri/normalize.ts`
- Test: `tests/ceviri-normalize.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `localeLower(text: string, lang: string): string`
  - `normalizeForMatch(text: string, lang: string): string`
  - `segmentHash(text: string, lang: string): string` — normalize edilmiş metnin sha256 hex'i

- [ ] **Step 1: Write the failing test**

`tests/ceviri-normalize.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { localeLower, normalizeForMatch, segmentHash } from "../lib/ceviri/normalize.ts";

test("lowercases Turkish dotted and dotless I correctly", () => {
  assert.equal(localeLower("İMZA", "tr-TR"), "imza");
  assert.equal(localeLower("IŞIK", "tr-TR"), "ışık");
  assert.equal(localeLower("MÜHÜR", "tr"), "mühür");
});

test("does not apply Turkish casing to non-Turkish text", () => {
  assert.equal(localeLower("I AGREE", "en-US"), "i agree");
  assert.equal(localeLower("REGISTRATION", "en-GB"), "registration");
});

test("collapses whitespace and trims", () => {
  assert.equal(normalizeForMatch("  Delan®   SC \n (BAS 216 17 F) ", "en-US"), "delan® sc (bas 216 17 f)");
});

test("hash is stable across whitespace and case differences", () => {
  assert.equal(segmentHash("Trade  NAME", "en-US"), segmentHash("trade name", "en-US"));
});

test("hash differs between languages for the dotless I", () => {
  assert.notEqual(segmentHash("ISIK", "tr-TR"), segmentHash("ISIK", "en-US"));
});

test("hash is a 64 character hex string", () => {
  assert.match(segmentHash("anything", "en-US"), /^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-normalize.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/normalize.ts'`

- [ ] **Step 3: Write minimal implementation**

`lib/ceviri/normalize.ts`:

```ts
import { createHash } from "node:crypto";

/** Turkish casing maps I→ı and İ→i; every other language maps I→i. */
export function localeLower(text: string, lang: string): string {
  const locale = lang.toLowerCase().startsWith("tr") ? "tr" : "en";
  return text.toLocaleLowerCase(locale);
}

/** Lowercase for the language, collapse all whitespace runs to one space, trim. */
export function normalizeForMatch(text: string, lang: string): string {
  return localeLower(text, lang).replace(/\s+/g, " ").trim();
}

/** sha256 of the normalized text, as lowercase hex. */
export function segmentHash(text: string, lang: string): string {
  return createHash("sha256").update(normalizeForMatch(text, lang), "utf8").digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-normalize.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ceviri/normalize.ts tests/ceviri-normalize.test.ts
git commit -m "Çeviri: dile duyarlı normalizasyon ve segment hash'i"
```

---

### Task 2: TMX akış ayrıştırıcısı

En büyük dosya 51 MB ve 69.581 segment içerir. Tümünü belleğe alıp DOM kurmak yerine parça parça okunur.

`<seg>` içinde satır içi etiket bulunabilir — gerçek veriden örnek:
`2-chloro- <g id="1">N</g>-(4'-chlorobiphenyl-2-yl)nicotinamide`. Etiketler atılır, metin korunur.

**Files:**
- Create: `lib/ceviri/tmx.ts`
- Test: `tests/ceviri-tmx.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `type TmxUnit = { sourceLang: string; targetLang: string; sourceText: string; targetText: string; projectName: string | null; contextPre: string | null; contextPost: string | null; origin: string | null }`
  - `parseTmxUnits(chunks: AsyncIterable<string>, fallbackSourceLang?: string): AsyncGenerator<TmxUnit>`
  - `segText(segXml: string): string`

- [ ] **Step 1: Write the failing test**

`tests/ceviri-tmx.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseTmxUnits, segText } from "../lib/ceviri/tmx.ts";

const TMX = `<?xml version="1.0" ?><tmx version="1.4"><header srclang="en-US"/><body>` +
  `<tu tuid="1" srclang="en-US">` +
  `<prop type="x-project_name">basf 11-08</prop>` +
  `<prop type="X-Lara-Engine-Translation-Origin">TM</prop>` +
  `<prop type="x-context-pre">% w/w</prop>` +
  `<prop type="x-context-post">Active Ingredient</prop>` +
  `<tuv xml:lang="en-US"><seg>Trade name</seg></tuv>` +
  `<tuv xml:lang="tr-TR"><seg>Ticari ad&#305;</seg></tuv>` +
  `</tu>` +
  `<tu tuid="2">` +
  `<tuv xml:lang="en-US"><seg>2-chloro- <g id="1">N</g>-(4'-chlorobiphenyl)</seg></tuv>` +
  `<tuv xml:lang="tr-TR"><seg>2-kloro- <g id="1">N</g>-(4'-klorobifenil)</seg></tuv>` +
  `</tu></body></tmx>`;

async function* feed(text: string, size: number) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

async function collect(text: string, size = 7) {
  const out = [];
  for await (const unit of parseTmxUnits(feed(text, size))) out.push(unit);
  return out;
}

test("strips inline tags but keeps their text content", () => {
  assert.equal(segText(`<seg>2-chloro- <g id="1">N</g>-yl</seg>`), "2-chloro- N-yl");
});

test("decodes numeric and named XML entities", () => {
  assert.equal(segText("<seg>Ticari ad&#305; &amp; kod</seg>"), "Ticari adı & kod");
});

test("extracts both language variants with metadata", async () => {
  const units = await collect(TMX);
  assert.equal(units.length, 2);
  assert.equal(units[0].sourceLang, "en-US");
  assert.equal(units[0].targetLang, "tr-TR");
  assert.equal(units[0].sourceText, "Trade name");
  assert.equal(units[0].targetText, "Ticari adı");
  assert.equal(units[0].projectName, "basf 11-08");
  assert.equal(units[0].origin, "TM");
  assert.equal(units[0].contextPre, "% w/w");
  assert.equal(units[0].contextPost, "Active Ingredient");
});

test("falls back to the header srclang when the tu has none", async () => {
  const units = await collect(TMX);
  assert.equal(units[1].sourceLang, "en-US");
  assert.equal(units[1].sourceText, "2-chloro- N-(4'-chlorobiphenyl)");
});

test("produces identical results regardless of chunk boundaries", async () => {
  const tiny = await collect(TMX, 3);
  const huge = await collect(TMX, 100000);
  assert.deepEqual(tiny, huge);
});

test("skips units that lack two language variants", async () => {
  const broken = `<tmx><header srclang="en-US"/><body><tu><tuv xml:lang="en-US"><seg>only</seg></tuv></tu></body></tmx>`;
  assert.deepEqual(await collect(broken), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-tmx.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/tmx.ts'`

- [ ] **Step 3: Write minimal implementation**

`lib/ceviri/tmx.ts`:

```ts
export type TmxUnit = {
  sourceLang: string;
  targetLang: string;
  sourceText: string;
  targetText: string;
  projectName: string | null;
  contextPre: string | null;
  contextPost: string | null;
  origin: string | null;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

/** Text content of a <seg>, with inline formatting tags removed. */
export function segText(segXml: string): string {
  const inner = segXml.replace(/^[\s\S]*?<seg[^>]*>/, "").replace(/<\/seg>[\s\S]*$/, "");
  return decodeEntities(inner.replace(/<[^>]+>/g, ""));
}

function prop(tuXml: string, type: string): string | null {
  const pattern = new RegExp(`<prop[^>]*type="${type}"[^>]*>([\\s\\S]*?)</prop>`, "i");
  const match = tuXml.match(pattern);
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, "")) : null;
}

function parseUnit(tuXml: string, fallbackSourceLang: string): TmxUnit | null {
  const tuvs = tuXml.match(/<tuv\b[\s\S]*?<\/tuv>/g) ?? [];
  if (tuvs.length < 2) return null;

  const langOf = (tuv: string) => (tuv.match(/xml:lang="([^"]*)"/) ?? tuv.match(/lang="([^"]*)"/) ?? [])[1] ?? "";
  const declared = (tuXml.match(/<tu\b[^>]*\bsrclang="([^"]*)"/) ?? [])[1] ?? fallbackSourceLang;

  const sourceTuv = tuvs.find((tuv) => langOf(tuv) === declared) ?? tuvs[0];
  const targetTuv = tuvs.find((tuv) => tuv !== sourceTuv);
  if (!targetTuv) return null;

  return {
    sourceLang: langOf(sourceTuv),
    targetLang: langOf(targetTuv),
    sourceText: segText(sourceTuv),
    targetText: segText(targetTuv),
    projectName: prop(tuXml, "x-project_name"),
    contextPre: prop(tuXml, "x-context-pre"),
    contextPost: prop(tuXml, "x-context-post"),
    origin: prop(tuXml, "X-Lara-Engine-Translation-Origin"),
  };
}

/**
 * Streams <tu> units out of TMX text chunks without holding the whole file.
 *
 * Only "<tu " and "<tu>" open a unit. Searching for the bare prefix "<tu"
 * would also hit "<tuv", which opens a language variant INSIDE a unit —
 * trimming the buffer there would cut the unit's own opening tag away.
 */
export async function* parseTmxUnits(
  chunks: AsyncIterable<string>,
  fallbackSourceLang = "",
): AsyncGenerator<TmxUnit> {
  let buffer = "";
  let headerLang = fallbackSourceLang;
  let sawHeader = false;

  const unitOpening = () => {
    const spaced = buffer.indexOf("<tu ");
    const bare = buffer.indexOf("<tu>");
    if (spaced === -1) return bare;
    if (bare === -1) return spaced;
    return Math.min(spaced, bare);
  };

  for await (const chunk of chunks) {
    buffer += chunk;

    if (!sawHeader) {
      const header = buffer.match(/<header\b[^>]*>/);
      if (header) {
        headerLang = (header[0].match(/srclang="([^"]*)"/) ?? [])[1] ?? headerLang;
        sawHeader = true;
      }
    }

    for (;;) {
      const start = unitOpening();
      if (start === -1) break;
      const end = buffer.indexOf("</tu>", start);
      if (end === -1) break;
      const unit = parseUnit(buffer.slice(start, end + 5), headerLang);
      if (unit) yield unit;
      buffer = buffer.slice(end + 5);
    }

    // Nothing before the next unit opening can still be needed.
    const next = unitOpening();
    if (next > 0) buffer = buffer.slice(next);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-tmx.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Verify against a real archive**

Bu adım gerçek veriyle duman testidir. Kullanıcının `Downloads` klasöründeki arşivi kullanır.

```bash
mkdir -p /tmp/tmxcheck && cd /tmp/tmxcheck
unzip -o "$HOME/Downloads/8b91bc58739147e10dde-.zip"
node --import tsx -e '
import { createReadStream } from "node:fs";
import { parseTmxUnits } from "./lib/ceviri/tmx.ts";
const stream = createReadStream("/tmp/tmxcheck/english__turkish.tmx", { encoding: "utf8" });
let n = 0; let first = null;
for await (const u of parseTmxUnits(stream)) { if (!first) first = u; n++; }
console.log("segment:", n); console.log("ilk:", first);
'
```

Expected: `segment: 4983` ve ilk segmentte dolu `sourceText`/`targetText`.
Sayı 4983 değilse ayrıştırıcıda hata vardır — devam etmeden düzeltin.

- [ ] **Step 6: Commit**

```bash
git add lib/ceviri/tmx.ts tests/ceviri-tmx.test.ts
git commit -m "Çeviri: TMX akış ayrıştırıcısı"
```

---

### Task 3: Terminoloji xlsx ayrıştırıcısı

xlsx bir zip arşividir. `unzip` komutuna bağımlı kalmamak için `fflate` kullanılır (Railway konteynerinde `unzip` bulunmayabilir).

Gerçek şema: `Forbidden | Domain | Subdomain | Definition` ardından her dil için üçlü `<dil-kodu> | Notes | Example of use`.

**Files:**
- Create: `lib/ceviri/termbase.ts`
- Modify: `package.json` (`fflate` bağımlılığı)
- Test: `tests/ceviri-termbase.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `type TermEntry = { lang: string; text: string; notes: string | null; example: string | null }`
  - `type TermRow = { forbidden: boolean; domain: string | null; subdomain: string | null; definition: string | null; entries: TermEntry[] }`
  - `parseTermbase(file: Uint8Array): { locales: string[]; rows: TermRow[] }`
  - `columnIndex(ref: string): number` — `"A"`→0, `"Z"`→25, `"AA"`→26

- [ ] **Step 1: Add the dependency**

```bash
npm install fflate
```

- [ ] **Step 2: Write the failing test**

Test, gerçek bir xlsx'i bellekte üretir — böylece dış dosyaya bağımlı olmaz.

`tests/ceviri-termbase.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { columnIndex, parseTermbase } from "../lib/ceviri/termbase.ts";

function sheetXml(rows: string[][]): string {
  const letters = (i: number) => {
    let s = ""; let n = i;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  };
  const body = rows.map((cells, r) =>
    `<row r="${r + 1}">` +
    cells.map((v, c) => v === "" ? "" : `<c r="${letters(c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`).join("") +
    `</row>`).join("");
  return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

function buildXlsx(rows: string[][]): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook><sheets><sheet name="Sheet0" sheetId="1"/></sheets></workbook>`),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(rows)),
  });
}

const HEADER = ["Forbidden", "Domain", "Subdomain", "Definition",
  "en-US", "Notes", "Example of use",
  "tr-TR", "Notes", "Example of use"];

test("maps spreadsheet column refs to zero based indexes", () => {
  assert.equal(columnIndex("A1"), 0);
  assert.equal(columnIndex("Z9"), 25);
  assert.equal(columnIndex("AA3"), 26);
  assert.equal(columnIndex("AB12"), 27);
});

test("reads locales from the header row", () => {
  const { locales } = parseTermbase(buildXlsx([HEADER]));
  assert.deepEqual(locales, ["en-US", "tr-TR"]);
});

test("pairs each locale with its own term, notes and example", () => {
  const { rows } = parseTermbase(buildXlsx([
    HEADER,
    ["false", "Pharma", "Label", "a legal permit", "Registration", "capitalised", "See §3", "Ruhsat", "resmi", "Bkz. §3"],
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].forbidden, false);
  assert.equal(rows[0].domain, "Pharma");
  assert.equal(rows[0].definition, "a legal permit");
  assert.deepEqual(rows[0].entries, [
    { lang: "en-US", text: "Registration", notes: "capitalised", example: "See §3" },
    { lang: "tr-TR", text: "Ruhsat", notes: "resmi", example: "Bkz. §3" },
  ]);
});

test("treats the Forbidden column as a boolean", () => {
  const { rows } = parseTermbase(buildXlsx([
    HEADER,
    ["true", "", "", "", "cover pricing", "", "", "göstermelik teklif", "", ""],
  ]));
  assert.equal(rows[0].forbidden, true);
});

test("omits locales with no term on that row", () => {
  const { rows } = parseTermbase(buildXlsx([
    HEADER,
    ["false", "", "", "", "Molar Mass", "", "", "", "", ""],
  ]));
  assert.deepEqual(rows[0].entries, [{ lang: "en-US", text: "Molar Mass", notes: null, example: null }]);
});

test("drops rows that carry no term in any locale", () => {
  const { rows } = parseTermbase(buildXlsx([HEADER, ["false", "", "", "", "", "", "", "", "", ""]]));
  assert.deepEqual(rows, []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-termbase.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/termbase.ts'`

- [ ] **Step 4: Write minimal implementation**

`lib/ceviri/termbase.ts`:

```ts
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

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
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
    rows.push(cells);
  }
  return rows;
}

function cell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function orNull(value: string): string | null {
  return value === "" ? null : value;
}

export function parseTermbase(file: Uint8Array): { locales: string[]; rows: TermRow[] } {
  const files = unzipSync(file);
  const sheetKey = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetKey) return { locales: [], rows: [] };

  const raw = sheetRows(strFromU8(files[sheetKey]), sharedStrings(files));
  if (raw.length === 0) return { locales: [], rows: [] };

  const header = raw[0];
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
      const text = cell(row, base);
      if (!text) return;
      entries.push({ lang, text, notes: orNull(cell(row, base + 1)), example: orNull(cell(row, base + 2)) });
    });
    if (entries.length === 0) continue;
    rows.push({
      forbidden: cell(row, 0).toLowerCase() === "true",
      domain: orNull(cell(row, 1)),
      subdomain: orNull(cell(row, 2)),
      definition: orNull(cell(row, 3)),
      entries,
    });
  }
  return { locales, rows };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-termbase.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 6: Verify against a real file**

```bash
node --import tsx -e '
import { readFileSync } from "node:fs";
import { parseTermbase } from "./lib/ceviri/termbase.ts";
const out = parseTermbase(readFileSync(process.env.HOME + "/Downloads/3759546f91c521e4d42c.xlsx"));
console.log("diller:", out.locales);
console.log("satır:", out.rows.length);
console.log("ilk:", JSON.stringify(out.rows[0]));
'
```

Expected: 8 dil (`de-DE`, `el-GR`, `en-GB`, `en-US`, `es-ES`, `it-IT`, `ru-RU`, `tr-TR`) ve 419 satır.

- [ ] **Step 7: Commit**

```bash
git add lib/ceviri/termbase.ts tests/ceviri-termbase.test.ts package.json package-lock.json
git commit -m "Çeviri: terminoloji xlsx ayrıştırıcısı"
```

---

### Task 4: Supabase istemcisi ve şema

Buradan itibaren `CEVIRI_SUPABASE_URL` ve `CEVIRI_SUPABASE_SERVICE_ROLE_KEY` gerekir.

**Files:**
- Create: `lib/ceviri/supabase.ts`
- Create: `supabase/ceviri/migrations/202609190001_knowledge_base.sql`
- Modify: `.env.example`
- Test: `tests/ceviri-supabase.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `getCeviriSupabase(): SupabaseClient`
  - `ceviriCredentials(): { url: string; serviceRoleKey: string }` — eksikse `Error` fırlatır

- [ ] **Step 1: Write the failing test**

`tests/ceviri-supabase.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ceviriCredentials } from "../lib/ceviri/supabase.ts";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try { run(); } finally { process.env = previous; }
}

test("returns both credentials when configured", () => {
  withEnv({ CEVIRI_SUPABASE_URL: "https://x.supabase.co", CEVIRI_SUPABASE_SERVICE_ROLE_KEY: "key" }, () => {
    assert.deepEqual(ceviriCredentials(), { url: "https://x.supabase.co", serviceRoleKey: "key" });
  });
});

test("names the missing variable so the operator can fix it", () => {
  withEnv({ CEVIRI_SUPABASE_URL: undefined, CEVIRI_SUPABASE_SERVICE_ROLE_KEY: "key" }, () => {
    assert.throws(() => ceviriCredentials(), /CEVIRI_SUPABASE_URL/);
  });
  withEnv({ CEVIRI_SUPABASE_URL: "https://x.supabase.co", CEVIRI_SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
    assert.throws(() => ceviriCredentials(), /CEVIRI_SUPABASE_SERVICE_ROLE_KEY/);
  });
});

test("refuses the blog project's credentials", () => {
  withEnv({ CEVIRI_SUPABASE_URL: "", CEVIRI_SUPABASE_SERVICE_ROLE_KEY: "" }, () => {
    assert.throws(() => ceviriCredentials(), /CEVIRI_SUPABASE_URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-supabase.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/supabase.ts'`

- [ ] **Step 3: Write minimal implementation**

`lib/ceviri/supabase.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { fetchWithRetry, integerEnv } from "../upstream";

export function ceviriCredentials(): { url: string; serviceRoleKey: string } {
  const url = process.env.CEVIRI_SUPABASE_URL;
  const serviceRoleKey = process.env.CEVIRI_SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("CEVIRI_SUPABASE_URL is not set.");
  if (!serviceRoleKey) throw new Error("CEVIRI_SUPABASE_SERVICE_ROLE_KEY is not set.");
  return { url, serviceRoleKey };
}

export function getCeviriSupabase() {
  const { url, serviceRoleKey } = ceviriCredentials();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { "X-Client-Info": "ttaa-ceviri-app" },
      fetch: (input, init) => fetchWithRetry(input, init, {
        upstream: "Supabase (çeviri)",
        timeoutMs: integerEnv("SUPABASE_REQUEST_TIMEOUT_MS", 30_000),
        maxAttempts: 3,
        retryUnsafe: true,
      }),
    },
  });
}
```

> `integerEnv` ve `fetchWithRetry` `lib/upstream.ts` içinde zaten dışa aktarılmıştır (satır 25 ve 59); değişiklik gerekmez. Bu dosya `lib/supabase.ts` ile aynı deseni izler.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-supabase.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Write the migration**

`supabase/ceviri/migrations/202609190001_knowledge_base.sql`:

```sql
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- Kapsam --------------------------------------------------------------

create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.sectors(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  default_sector_id uuid references public.sectors(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- İçe aktarma kaydı ---------------------------------------------------

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tmx', 'termbase-xlsx', 'reference-archive')),
  filename text not null,
  file_hash text not null,
  stats jsonb not null default '{}'::jsonb,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Terminoloji ---------------------------------------------------------

create table if not exists public.term_concepts (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global', 'sector', 'client')),
  scope_id uuid,
  domain text,
  subdomain text,
  definition text,
  import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint term_concepts_scope_id_matches_type
    check ((scope_type = 'global') = (scope_id is null))
);

create table if not exists public.term_variants (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.term_concepts(id) on delete cascade,
  lang text not null,
  text text not null,
  normalized text not null,
  is_preferred boolean not null default true,
  is_forbidden boolean not null default false,
  notes text,
  example text,
  created_at timestamptz not null default now()
);

create index if not exists term_variants_concept_idx on public.term_variants (concept_id);
create index if not exists term_variants_lookup_idx on public.term_variants (lang, normalized);

-- Çeviri belleği ------------------------------------------------------

create table if not exists public.tm_segments (
  id uuid primary key default gen_random_uuid(),
  source_lang text not null,
  target_lang text not null,
  source_text text not null,
  target_text text not null,
  source_hash text not null,
  target_hash text not null,
  source_normalized text not null,
  client_id uuid references public.clients(id) on delete set null,
  sector_id uuid references public.sectors(id) on delete set null,
  project_names text[] not null default '{}',
  origin text not null default 'tmx-import'
    check (origin in ('tmx-import', 'human-approved', 'engine')),
  quality text not null default 'draft'
    check (quality in ('approved', 'draft')),
  context_pre text,
  context_post text,
  import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by text
);

-- Tekilleştirme anahtarı (spec 5.3)
create unique index if not exists tm_segments_dedupe_idx
  on public.tm_segments (source_lang, target_lang, source_hash, target_hash);

-- Birebir eşleşme
create index if not exists tm_segments_exact_idx
  on public.tm_segments (source_lang, target_lang, source_hash);

-- Bulanık eşleşme
create index if not exists tm_segments_trgm_idx
  on public.tm_segments using gin (source_normalized gin_trgm_ops);

-- Erişim: yalnızca service-role -----------------------------------------

alter table public.sectors        enable row level security;
alter table public.clients        enable row level security;
alter table public.imports        enable row level security;
alter table public.term_concepts  enable row level security;
alter table public.term_variants  enable row level security;
alter table public.tm_segments    enable row level security;

revoke all on public.sectors       from anon, authenticated;
revoke all on public.clients       from anon, authenticated;
revoke all on public.imports       from anon, authenticated;
revoke all on public.term_concepts from anon, authenticated;
revoke all on public.term_variants from anon, authenticated;
revoke all on public.tm_segments   from anon, authenticated;
```

- [ ] **Step 6: Apply the migration**

Supabase panelinde yeni projeyi açın → SQL Editor → yukarıdaki dosyanın içeriğini yapıştırıp çalıştırın.

Doğrulama sorgusu:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```

Expected: `clients`, `imports`, `sectors`, `term_concepts`, `term_variants`, `tm_segments`.

```sql
select extname from pg_extension where extname in ('pg_trgm', 'pgcrypto');
```

Expected: iki satır.

- [ ] **Step 7: Record the credentials**

`.env.example` dosyasına ekleyin:

```
# Çeviri APP — AYRI Supabase projesi (blog projesiyle karıştırmayın)
CEVIRI_SUPABASE_URL=https://YOUR_CEVIRI_REF.supabase.co
CEVIRI_SUPABASE_SERVICE_ROLE_KEY=your-ceviri-service-role-key
```

Gerçek değerleri `.env.local` dosyasına yazın. `.env.local` `.gitignore` kapsamındadır, commit edilmez.

- [ ] **Step 8: Commit**

```bash
git add lib/ceviri/supabase.ts tests/ceviri-supabase.test.ts \
        supabase/ceviri/migrations/202609190001_knowledge_base.sql .env.example
git commit -m "Çeviri: ayrı Supabase projesi istemcisi ve bilgi tabanı şeması"
```

---

### Task 5: TM içe aktarma ve tekilleştirme

**Files:**
- Create: `lib/ceviri/tm-store.ts`
- Create: `scripts/ceviri-import-tmx.ts`
- Modify: `package.json` (`ceviri:import-tmx` komutu)
- Test: `tests/ceviri-tm-store.test.ts`

**Interfaces:**
- Consumes: `TmxUnit` (Task 2), `segmentHash`/`normalizeForMatch` (Task 1), `getCeviriSupabase` (Task 4)
- Produces:
  - `type TmRow = { source_lang: string; target_lang: string; source_text: string; target_text: string; source_hash: string; target_hash: string; source_normalized: string; project_names: string[]; origin: string; context_pre: string | null; context_post: string | null }`
  - `toTmRow(unit: TmxUnit): TmRow | null` — boş metinli birimlerde `null`
  - `dedupeRows(rows: TmRow[]): TmRow[]` — parti içi tekilleştirme, proje etiketlerini birleştirir
  - `insertTmRows(rows: TmRow[], context: { importId: string; clientId?: string | null; sectorId?: string | null }): Promise<number>`

- [ ] **Step 1: Write the failing test**

Test yalnızca saf dönüşüm ve tekilleştirmeyi kapsar; veritabanı yazımı Adım 6'daki gerçek çalıştırmayla doğrulanır.

`tests/ceviri-tm-store.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { dedupeRows, toTmRow } from "../lib/ceviri/tm-store.ts";
import type { TmxUnit } from "../lib/ceviri/tmx.ts";

function unit(over: Partial<TmxUnit> = {}): TmxUnit {
  return {
    sourceLang: "en-US", targetLang: "tr-TR",
    sourceText: "Trade name", targetText: "Ticari adı",
    projectName: "basf 11-08", contextPre: null, contextPost: null, origin: "TM",
    ...over,
  };
}

test("builds a row with hashes and a normalized source", () => {
  const row = toTmRow(unit())!;
  assert.equal(row.source_normalized, "trade name");
  assert.match(row.source_hash, /^[0-9a-f]{64}$/);
  assert.match(row.target_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(row.project_names, ["basf 11-08"]);
  assert.equal(row.origin, "tmx-import");
});

test("rejects units with an empty side", () => {
  assert.equal(toTmRow(unit({ sourceText: "   " })), null);
  assert.equal(toTmRow(unit({ targetText: "" })), null);
});

test("uses an empty project list when the TMX has no project name", () => {
  assert.deepEqual(toTmRow(unit({ projectName: null }))!.project_names, []);
});

test("collapses duplicates that differ only by case or spacing", () => {
  const rows = dedupeRows([
    toTmRow(unit())!,
    toTmRow(unit({ sourceText: "TRADE   NAME" }))!,
  ]);
  assert.equal(rows.length, 1);
});

test("merges project tags of collapsed duplicates without repeating them", () => {
  const rows = dedupeRows([
    toTmRow(unit({ projectName: "basf 11-08" }))!,
    toTmRow(unit({ projectName: "basf 08-06" }))!,
    toTmRow(unit({ projectName: "basf 11-08" }))!,
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual([...rows[0].project_names].sort(), ["basf 08-06", "basf 11-08"]);
});

test("keeps rows apart when the target text differs", () => {
  const rows = dedupeRows([
    toTmRow(unit())!,
    toTmRow(unit({ targetText: "Ticaret unvanı" }))!,
  ]);
  assert.equal(rows.length, 2);
});

test("keeps rows apart when the language pair differs", () => {
  const rows = dedupeRows([
    toTmRow(unit())!,
    toTmRow(unit({ targetLang: "de-DE", targetText: "Handelsname" }))!,
  ]);
  assert.equal(rows.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-tm-store.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/tm-store.ts'`

- [ ] **Step 3: Write minimal implementation**

`lib/ceviri/tm-store.ts`:

```ts
import { getCeviriSupabase } from "./supabase";
import { normalizeForMatch, segmentHash } from "./normalize";
import type { TmxUnit } from "./tmx";

export type TmRow = {
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  source_hash: string;
  target_hash: string;
  source_normalized: string;
  project_names: string[];
  origin: string;
  context_pre: string | null;
  context_post: string | null;
};

export function toTmRow(unit: TmxUnit): TmRow | null {
  const sourceText = unit.sourceText.trim();
  const targetText = unit.targetText.trim();
  if (!sourceText || !targetText || !unit.sourceLang || !unit.targetLang) return null;

  return {
    source_lang: unit.sourceLang,
    target_lang: unit.targetLang,
    source_text: sourceText,
    target_text: targetText,
    source_hash: segmentHash(sourceText, unit.sourceLang),
    target_hash: segmentHash(targetText, unit.targetLang),
    source_normalized: normalizeForMatch(sourceText, unit.sourceLang),
    project_names: unit.projectName ? [unit.projectName] : [],
    // TMX'in kendi köken etiketi (TM/MT/Lara) kalite sinyalidir, origin değil.
    origin: "tmx-import",
    context_pre: unit.contextPre,
    context_post: unit.contextPost,
  };
}

function dedupeKey(row: TmRow): string {
  return [row.source_lang, row.target_lang, row.source_hash, row.target_hash].join(" ");
}

/** Collapses duplicates inside one batch, merging their project tags. */
export function dedupeRows(rows: TmRow[]): TmRow[] {
  const byKey = new Map<string, TmRow>();
  for (const row of rows) {
    const key = dedupeKey(row);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...row, project_names: [...row.project_names] });
      continue;
    }
    for (const tag of row.project_names) {
      if (!seen.project_names.includes(tag)) seen.project_names.push(tag);
    }
    seen.context_pre ??= row.context_pre;
    seen.context_post ??= row.context_post;
  }
  return [...byKey.values()];
}

/**
 * Writes a batch, ignoring rows that already exist under the dedupe key.
 * Returns how many rows the database actually stored.
 */
export async function insertTmRows(
  rows: TmRow[],
  context: { importId: string; clientId?: string | null; sectorId?: string | null },
): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = getCeviriSupabase();
  const payload = dedupeRows(rows).map((row) => ({
    ...row,
    import_id: context.importId,
    client_id: context.clientId ?? null,
    sector_id: context.sectorId ?? null,
  }));

  const { data, error } = await supabase
    .from("tm_segments")
    .upsert(payload, {
      onConflict: "source_lang,target_lang,source_hash,target_hash",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) throw new Error(`tm_segments upsert failed: ${error.message}`);
  return data?.length ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-tm-store.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Write the import command**

`scripts/ceviri-import-tmx.ts`:

```ts
/**
 * Usage: npm run ceviri:import-tmx -- <dosya-veya-klasör> [--client <slug>] [--sector <slug>]
 * Accepts a .tmx file or a directory containing .tmx files.
 */
import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

// .env.local'i okur; scripts/content-worker.ts ile aynı desen.
nextEnv.loadEnvConfig(process.cwd());

import { getCeviriSupabase } from "../lib/ceviri/supabase";
import { parseTmxUnits } from "../lib/ceviri/tmx";
import { insertTmRows, toTmRow, type TmRow } from "../lib/ceviri/tm-store";

const BATCH = 500;

async function tmxFiles(target: string): Promise<string[]> {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const names = await readdir(target);
  return names.filter((n) => n.toLowerCase().endsWith(".tmx")).map((n) => join(target, n)).sort();
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function scopeId(table: "clients" | "sectors", slug: string | null): Promise<string | null> {
  if (!slug) return null;
  const { data, error } = await getCeviriSupabase().from(table).select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  if (!data) throw new Error(`${table} with slug "${slug}" not found. Create it first.`);
  return data.id as string;
}

async function importFile(path: string, clientId: string | null, sectorId: string | null) {
  const supabase = getCeviriSupabase();
  const fileHash = createHash("sha256").update(await readFile(path)).digest("hex");

  const { data: imp, error: impError } = await supabase
    .from("imports")
    .insert({ kind: "tmx", filename: basename(path), file_hash: fileHash })
    .select("id")
    .single();
  if (impError) throw new Error(`imports insert failed: ${impError.message}`);
  const importId = imp.id as string;

  let seen = 0;
  let stored = 0;
  let skipped = 0;
  let batch: TmRow[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    stored += await insertTmRows(batch, { importId, clientId, sectorId });
    batch = [];
  };

  try {
    const stream = createReadStream(path, { encoding: "utf8" });
    for await (const unit of parseTmxUnits(stream)) {
      seen += 1;
      const row = toTmRow(unit);
      if (!row) { skipped += 1; continue; }
      batch.push(row);
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    await supabase.from("imports").update({
      status: "succeeded",
      stats: { seen, stored, skipped, duplicates: seen - skipped - stored },
      finished_at: new Date().toISOString(),
    }).eq("id", importId);

    console.log(`${basename(path)}: ${seen} okundu, ${stored} yazıldı, ${skipped} boş, ${seen - skipped - stored} tekrar`);
  } catch (error) {
    await supabase.from("imports").update({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      finished_at: new Date().toISOString(),
    }).eq("id", importId);
    throw error;
  }
}

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: npm run ceviri:import-tmx -- <dosya-veya-klasör> [--client <slug>] [--sector <slug>]");

  const clientId = await scopeId("clients", argValue("--client"));
  const sectorId = await scopeId("sectors", argValue("--sector"));

  for (const path of await tmxFiles(target)) {
    await importFile(path, clientId, sectorId);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

`package.json` `scripts` bölümüne ekleyin:

```json
"ceviri:import-tmx": "tsx scripts/ceviri-import-tmx.ts",
```

- [ ] **Step 6: Import one real archive and check the numbers**

Önce müşteri ve sektör kaydı oluşturun (Supabase SQL Editor):

```sql
insert into public.sectors (name, slug) values ('Zirai ilaç', 'zirai-ilac')
  on conflict (slug) do nothing;
insert into public.clients (name, slug, default_sector_id)
  select 'BASF', 'basf', id from public.sectors where slug = 'zirai-ilac'
  on conflict (slug) do nothing;
```

En küçük arşivle başlayın:

```bash
mkdir -p /tmp/tmx1 && cd /tmp/tmx1 && unzip -o "$HOME/Downloads/8b91bc58739147e10dde-.zip"
cd -
npm run ceviri:import-tmx -- /tmp/tmx1 --client basf --sector zirai-ilac
```

Expected: `english__turkish.tmx: 4983 okundu, ~4983 yazıldı, 0 boş`
(bu arşiv tek başına içe aktarıldığı için tekrar sayısı düşük olmalı).

Şimdi örtüşmeyi kanıtlayın — ikinci arşivde aynı dosya adı var:

```bash
mkdir -p /tmp/tmx2 && cd /tmp/tmx2 && unzip -o "$HOME/Downloads/bcdff8705521eb59adfc-.zip"
cd -
npm run ceviri:import-tmx -- /tmp/tmx2/english__turkish.tmx --client basf --sector zirai-ilac
```

Expected: 33817 okundu, yazılan sayı 33817'den **belirgin biçimde az**, kalanı `tekrar`.
Tekrar sayısı sıfırsa tekilleştirme çalışmıyordur — devam etmeden inceleyin.

- [ ] **Step 7: Commit**

```bash
git add lib/ceviri/tm-store.ts scripts/ceviri-import-tmx.ts tests/ceviri-tm-store.test.ts package.json
git commit -m "Çeviri: TM içe aktarma ve tekilleştirme"
```

---

### Task 6: Terminoloji içe aktarma

**Files:**
- Create: `lib/ceviri/term-store.ts`
- Create: `scripts/ceviri-import-terms.ts`
- Modify: `package.json` (`ceviri:import-terms` komutu)
- Test: `tests/ceviri-term-store.test.ts`

**Interfaces:**
- Consumes: `TermRow` (Task 3), `normalizeForMatch` (Task 1), `getCeviriSupabase` (Task 4)
- Produces:
  - `type ConceptScope = { scopeType: "global" | "sector" | "client"; scopeId: string | null }`
  - `type VariantInsert = { lang: string; text: string; normalized: string; is_preferred: boolean; is_forbidden: boolean; notes: string | null; example: string | null }`
  - `toVariantInserts(row: TermRow): VariantInsert[]`
  - `importTermRows(rows: TermRow[], context: { scope: ConceptScope; importId: string }): Promise<{ concepts: number; variants: number }>`

- [ ] **Step 1: Write the failing test**

`tests/ceviri-term-store.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { toVariantInserts } from "../lib/ceviri/term-store.ts";
import type { TermRow } from "../lib/ceviri/termbase.ts";

function row(over: Partial<TermRow> = {}): TermRow {
  return {
    forbidden: false, domain: null, subdomain: null, definition: null,
    entries: [
      { lang: "en-US", text: "Registration", notes: null, example: null },
      { lang: "tr-TR", text: "Ruhsat", notes: "resmi", example: null },
    ],
    ...over,
  };
}

test("normalizes each variant in its own language", () => {
  const variants = toVariantInserts(row({
    entries: [{ lang: "tr-TR", text: "IŞIK", notes: null, example: null }],
  }));
  assert.equal(variants[0].normalized, "ışık");
});

test("normalizes English variants with English casing", () => {
  const variants = toVariantInserts(row({
    entries: [{ lang: "en-US", text: "ISO Standard", notes: null, example: null }],
  }));
  assert.equal(variants[0].normalized, "iso standard");
});

test("a normal row yields preferred, non forbidden variants", () => {
  const variants = toVariantInserts(row());
  assert.equal(variants.length, 2);
  assert.ok(variants.every((v) => v.is_preferred && !v.is_forbidden));
  assert.equal(variants[1].notes, "resmi");
});

test("a forbidden row yields forbidden, non preferred variants", () => {
  const variants = toVariantInserts(row({ forbidden: true }));
  assert.ok(variants.every((v) => v.is_forbidden && !v.is_preferred));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-term-store.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/term-store.ts'`

- [ ] **Step 3: Write minimal implementation**

`lib/ceviri/term-store.ts`:

```ts
import { getCeviriSupabase } from "./supabase";
import { normalizeForMatch } from "./normalize";
import type { TermRow } from "./termbase";

export type ConceptScope = { scopeType: "global" | "sector" | "client"; scopeId: string | null };

export type VariantInsert = {
  lang: string;
  text: string;
  normalized: string;
  is_preferred: boolean;
  is_forbidden: boolean;
  notes: string | null;
  example: string | null;
};

export function toVariantInserts(row: TermRow): VariantInsert[] {
  return row.entries.map((entry) => ({
    lang: entry.lang,
    text: entry.text,
    normalized: normalizeForMatch(entry.text, entry.lang),
    is_preferred: !row.forbidden,
    is_forbidden: row.forbidden,
    notes: entry.notes,
    example: entry.example,
  }));
}

export async function importTermRows(
  rows: TermRow[],
  context: { scope: ConceptScope; importId: string },
): Promise<{ concepts: number; variants: number }> {
  if (rows.length === 0) return { concepts: 0, variants: 0 };
  const supabase = getCeviriSupabase();

  const { data: concepts, error: conceptError } = await supabase
    .from("term_concepts")
    .insert(rows.map((row) => ({
      scope_type: context.scope.scopeType,
      scope_id: context.scope.scopeId,
      domain: row.domain,
      subdomain: row.subdomain,
      definition: row.definition,
      import_id: context.importId,
    })))
    .select("id");

  if (conceptError) throw new Error(`term_concepts insert failed: ${conceptError.message}`);
  if (!concepts || concepts.length !== rows.length) {
    throw new Error(`Expected ${rows.length} concepts, got ${concepts?.length ?? 0}.`);
  }

  const variants = rows.flatMap((row, index) =>
    toVariantInserts(row).map((variant) => ({ ...variant, concept_id: concepts[index].id })));

  const { error: variantError } = await supabase.from("term_variants").insert(variants);
  if (variantError) throw new Error(`term_variants insert failed: ${variantError.message}`);

  return { concepts: concepts.length, variants: variants.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-term-store.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Write the import command**

`scripts/ceviri-import-terms.ts`:

```ts
/**
 * Usage: npm run ceviri:import-terms -- <dosya.xlsx> --scope <global|sector|client> [--slug <slug>]
 */
import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// .env.local'i okur; scripts/content-worker.ts ile aynı desen.
nextEnv.loadEnvConfig(process.cwd());

import { getCeviriSupabase } from "../lib/ceviri/supabase";
import { parseTermbase } from "../lib/ceviri/termbase";
import { importTermRows, type ConceptScope } from "../lib/ceviri/term-store";

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function resolveScope(): Promise<ConceptScope> {
  const scopeType = (argValue("--scope") ?? "global") as ConceptScope["scopeType"];
  if (!["global", "sector", "client"].includes(scopeType)) {
    throw new Error(`--scope must be global, sector or client (got "${scopeType}").`);
  }
  if (scopeType === "global") return { scopeType, scopeId: null };

  const slug = argValue("--slug");
  if (!slug) throw new Error(`--slug is required when --scope is ${scopeType}.`);

  const table = scopeType === "client" ? "clients" : "sectors";
  const { data, error } = await getCeviriSupabase().from(table).select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  if (!data) throw new Error(`${table} with slug "${slug}" not found. Create it first.`);
  return { scopeType, scopeId: data.id as string };
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run ceviri:import-terms -- <dosya.xlsx> --scope <global|sector|client> [--slug <slug>]");

  const scope = await resolveScope();
  const supabase = getCeviriSupabase();
  const bytes = await readFile(path);
  const { locales, rows } = parseTermbase(bytes);

  const { data: imp, error: impError } = await supabase
    .from("imports")
    .insert({
      kind: "termbase-xlsx",
      filename: basename(path),
      file_hash: createHash("sha256").update(bytes).digest("hex"),
    })
    .select("id")
    .single();
  if (impError) throw new Error(`imports insert failed: ${impError.message}`);

  try {
    const result = await importTermRows(rows, { scope, importId: imp.id as string });
    await supabase.from("imports").update({
      status: "succeeded",
      stats: { locales, ...result },
      finished_at: new Date().toISOString(),
    }).eq("id", imp.id);
    console.log(`${basename(path)}: ${result.concepts} kavram, ${result.variants} karşılık, diller: ${locales.join(", ")}`);
  } catch (error) {
    await supabase.from("imports").update({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      finished_at: new Date().toISOString(),
    }).eq("id", imp.id);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

`package.json` `scripts` bölümüne ekleyin:

```json
"ceviri:import-terms": "tsx scripts/ceviri-import-terms.ts",
```

- [ ] **Step 6: Import a real termbase**

> Dosyaların hangi müşteriye ait olduğu henüz bildirilmedi (spec bölüm 9, madde 2).
> Bu bilgi gelene kadar `--scope global` kullanın; kapsam sonradan `term_concepts`
> güncellenerek değiştirilebilir.

```bash
npm run ceviri:import-terms -- "$HOME/Downloads/3759546f91c521e4d42c.xlsx" --scope global
```

Expected: `419 kavram, ... karşılık, diller: de-DE, el-GR, en-GB, en-US, es-ES, it-IT, ru-RU, tr-TR`

- [ ] **Step 7: Commit**

```bash
git add lib/ceviri/term-store.ts scripts/ceviri-import-terms.ts tests/ceviri-term-store.test.ts package.json
git commit -m "Çeviri: terminoloji içe aktarma"
```

---

### Task 7: TM arama

Birebir eşleşme hash üzerinden %100 sayılır. Diğer durumlarda skor `pg_trgm` `similarity()` değeridir (spec 6.1).

**Files:**
- Create: `supabase/ceviri/migrations/202609190002_tm_search.sql`
- Modify: `lib/ceviri/tm-store.ts`
- Test: `tests/ceviri-tm-search.test.ts`

**Interfaces:**
- Consumes: `segmentHash`, `normalizeForMatch`, `getCeviriSupabase`
- Produces:
  - `type TmMatch = { id: string; source_text: string; target_text: string; score: number; origin: string; quality: string; project_names: string[] }`
  - `searchTm(query: { sourceText: string; sourceLang: string; targetLang: string; clientId?: string | null; sectorId?: string | null; limit?: number; minScore?: number }): Promise<TmMatch[]>`
  - `matchTier(score: number): "exact" | "fuzzy" | "none"` — eşikler: ≥0.95 exact, ≥0.75 fuzzy

- [ ] **Step 1: Write the failing test**

`tests/ceviri-tm-search.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { matchTier } from "../lib/ceviri/tm-store.ts";

test("treats 95 percent and above as an exact tier", () => {
  assert.equal(matchTier(1), "exact");
  assert.equal(matchTier(0.95), "exact");
});

test("treats 75 to 95 percent as the fuzzy tier", () => {
  assert.equal(matchTier(0.94), "fuzzy");
  assert.equal(matchTier(0.75), "fuzzy");
});

test("treats anything below 75 percent as no usable match", () => {
  assert.equal(matchTier(0.7499), "none");
  assert.equal(matchTier(0), "none");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-tm-search.test.ts`
Expected: FAIL — `matchTier is not exported` / not a function

- [ ] **Step 3: Write the search SQL function**

`supabase/ceviri/migrations/202609190002_tm_search.sql`:

```sql
-- Exact matches score 1. Everything else scores by trigram similarity.
-- Rows scoped to the caller's client or sector rank above unscoped rows.
create or replace function public.search_tm(
  p_source_normalized text,
  p_source_hash       text,
  p_source_lang       text,
  p_target_lang       text,
  p_client_id         uuid default null,
  p_sector_id         uuid default null,
  p_min_score         real default 0.75,
  p_limit             integer default 10
)
returns table (
  id            uuid,
  source_text   text,
  target_text   text,
  score         real,
  origin        text,
  quality       text,
  project_names text[]
)
language sql
stable
as $$
  select
    s.id,
    s.source_text,
    s.target_text,
    case when s.source_hash = p_source_hash then 1.0::real
         else similarity(s.source_normalized, p_source_normalized) end as score,
    s.origin,
    s.quality,
    s.project_names
  from public.tm_segments s
  where s.source_lang = p_source_lang
    and s.target_lang = p_target_lang
    and (
      s.source_hash = p_source_hash
      or s.source_normalized % p_source_normalized
    )
    and (
      case when s.source_hash = p_source_hash then 1.0::real
           else similarity(s.source_normalized, p_source_normalized) end
    ) >= p_min_score
  order by
    score desc,
    (s.origin = 'human-approved') desc,
    (p_client_id is not null and s.client_id = p_client_id) desc,
    (p_sector_id is not null and s.sector_id = p_sector_id) desc,
    s.created_at asc
  limit p_limit;
$$;

revoke all on function public.search_tm(text, text, text, text, uuid, uuid, real, integer)
  from anon, authenticated;
```

Migrasyonu Supabase SQL Editor'da çalıştırın.

- [ ] **Step 4: Add the client side search**

`lib/ceviri/tm-store.ts` dosyasının sonuna ekleyin:

```ts
export type TmMatch = {
  id: string;
  source_text: string;
  target_text: string;
  score: number;
  origin: string;
  quality: string;
  project_names: string[];
};

export const EXACT_THRESHOLD = 0.95;
export const FUZZY_THRESHOLD = 0.75;

/** Which cascade branch a score falls into (spec 6.1). */
export function matchTier(score: number): "exact" | "fuzzy" | "none" {
  if (score >= EXACT_THRESHOLD) return "exact";
  if (score >= FUZZY_THRESHOLD) return "fuzzy";
  return "none";
}

export async function searchTm(query: {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  clientId?: string | null;
  sectorId?: string | null;
  limit?: number;
  minScore?: number;
}): Promise<TmMatch[]> {
  const { data, error } = await getCeviriSupabase().rpc("search_tm", {
    p_source_normalized: normalizeForMatch(query.sourceText, query.sourceLang),
    p_source_hash: segmentHash(query.sourceText, query.sourceLang),
    p_source_lang: query.sourceLang,
    p_target_lang: query.targetLang,
    p_client_id: query.clientId ?? null,
    p_sector_id: query.sectorId ?? null,
    p_min_score: query.minScore ?? FUZZY_THRESHOLD,
    p_limit: query.limit ?? 10,
  });

  if (error) throw new Error(`search_tm failed: ${error.message}`);
  return (data ?? []) as TmMatch[];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-tm-search.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 6: Verify against the imported data**

```bash
node --import tsx -e '
import { searchTm, matchTier } from "./lib/ceviri/tm-store.ts";
const exact = await searchTm({ sourceText: "Trade name", sourceLang: "en-US", targetLang: "tr-TR" });
console.log("birebir:", exact[0]?.score, exact[0]?.target_text, matchTier(exact[0]?.score ?? 0));
const fuzzy = await searchTm({ sourceText: "Trade  NAME of product", sourceLang: "en-US", targetLang: "tr-TR" });
console.log("bulanık:", fuzzy.slice(0, 3).map((m) => [m.score.toFixed(2), m.target_text]));
'
```

Expected: birebir sorgu `1` skoruyla döner; bulanık sorgu 1 ile 0,75 arasında skorlar döner.
Hiç sonuç gelmiyorsa önce `select count(*) from tm_segments;` ile verinin yüklendiğini doğrulayın.

- [ ] **Step 7: Commit**

```bash
git add lib/ceviri/tm-store.ts tests/ceviri-tm-search.test.ts \
        supabase/ceviri/migrations/202609190002_tm_search.sql
git commit -m "Çeviri: TM arama (birebir + trigram bulanık eşleşme)"
```

---

### Task 8: Katmanlı terim çözümleme

Çakışmada `client` > `sector` > `global` (spec 5.1).

**Files:**
- Create: `supabase/ceviri/migrations/202609190003_term_lookup.sql`
- Modify: `lib/ceviri/term-store.ts`
- Test: `tests/ceviri-term-resolve.test.ts`

**Interfaces:**
- Consumes: `normalizeForMatch`, `getCeviriSupabase`
- Produces:
  - `type TermHit = { conceptId: string; scopeType: string; sourceText: string; targetText: string; isForbidden: boolean; notes: string | null }`
  - `scopeRank(scopeType: string): number` — `client`=3, `sector`=2, `global`=1
  - `pickWinners(hits: TermHit[]): { preferred: TermHit[]; forbidden: TermHit[] }`
  - `lookupTerms(query: { sourceText: string; sourceLang: string; targetLang: string; clientId?: string | null; sectorId?: string | null }): Promise<{ preferred: TermHit[]; forbidden: TermHit[] }>`

- [ ] **Step 1: Write the failing test**

`tests/ceviri-term-resolve.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { pickWinners, scopeRank } from "../lib/ceviri/term-store.ts";
import type { TermHit } from "../lib/ceviri/term-store.ts";

function hit(over: Partial<TermHit> = {}): TermHit {
  return {
    conceptId: "c1", scopeType: "global",
    sourceText: "Registration", targetText: "Kayıt",
    isForbidden: false, notes: null,
    ...over,
  };
}

test("ranks client scope above sector above global", () => {
  assert.ok(scopeRank("client") > scopeRank("sector"));
  assert.ok(scopeRank("sector") > scopeRank("global"));
});

test("a client term overrides the sector and global terms for the same source", () => {
  const { preferred } = pickWinners([
    hit({ conceptId: "g", scopeType: "global", targetText: "Kayıt" }),
    hit({ conceptId: "s", scopeType: "sector", targetText: "Ruhsat" }),
    hit({ conceptId: "c", scopeType: "client", targetText: "Tescil" }),
  ]);
  assert.equal(preferred.length, 1);
  assert.equal(preferred[0].targetText, "Tescil");
});

test("keeps terms for different source words side by side", () => {
  const { preferred } = pickWinners([
    hit({ sourceText: "Registration", targetText: "Ruhsat" }),
    hit({ sourceText: "Trade name", targetText: "Ticari ad" }),
  ]);
  assert.equal(preferred.length, 2);
});

test("collects forbidden terms separately and never as preferred", () => {
  const { preferred, forbidden } = pickWinners([
    hit({ targetText: "Ruhsat" }),
    hit({ conceptId: "f", targetText: "Rejistrasyon", isForbidden: true }),
  ]);
  assert.deepEqual(preferred.map((h) => h.targetText), ["Ruhsat"]);
  assert.deepEqual(forbidden.map((h) => h.targetText), ["Rejistrasyon"]);
});

test("a forbidden term at client scope does not suppress the preferred term", () => {
  const { preferred, forbidden } = pickWinners([
    hit({ scopeType: "global", targetText: "Ruhsat" }),
    hit({ scopeType: "client", targetText: "Rejistrasyon", isForbidden: true }),
  ]);
  assert.deepEqual(preferred.map((h) => h.targetText), ["Ruhsat"]);
  assert.equal(forbidden.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-term-resolve.test.ts`
Expected: FAIL — `pickWinners is not exported`

- [ ] **Step 3: Write the lookup SQL function**

`supabase/ceviri/migrations/202609190003_term_lookup.sql`:

```sql
-- Returns every term whose source variant appears in the caller's text,
-- limited to the global scope plus the caller's own sector and client.
create or replace function public.lookup_terms(
  p_text        text,
  p_source_lang text,
  p_target_lang text,
  p_client_id   uuid default null,
  p_sector_id   uuid default null
)
returns table (
  concept_id  uuid,
  scope_type  text,
  source_text text,
  target_text text,
  is_forbidden boolean,
  notes       text
)
language sql
stable
as $$
  select
    c.id,
    c.scope_type,
    src.text,
    tgt.text,
    tgt.is_forbidden,
    tgt.notes
  from public.term_concepts c
  join public.term_variants src on src.concept_id = c.id and src.lang = p_source_lang
  join public.term_variants tgt on tgt.concept_id = c.id and tgt.lang = p_target_lang
  where position(src.normalized in p_text) > 0
    and (
      c.scope_type = 'global'
      or (c.scope_type = 'sector' and c.scope_id = p_sector_id)
      or (c.scope_type = 'client' and c.scope_id = p_client_id)
    );
$$;

revoke all on function public.lookup_terms(text, text, text, uuid, uuid)
  from anon, authenticated;
```

Migrasyonu Supabase SQL Editor'da çalıştırın.

- [ ] **Step 4: Add the client side resolution**

`lib/ceviri/term-store.ts` dosyasının sonuna ekleyin:

```ts
export type TermHit = {
  conceptId: string;
  scopeType: string;
  sourceText: string;
  targetText: string;
  isForbidden: boolean;
  notes: string | null;
};

/** client beats sector beats global (spec 5.1). */
export function scopeRank(scopeType: string): number {
  if (scopeType === "client") return 3;
  if (scopeType === "sector") return 2;
  return 1;
}

/**
 * Forbidden terms are never suppressed — every one of them must reach QA.
 * Preferred terms compete per source word, and the narrowest scope wins.
 */
export function pickWinners(hits: TermHit[]): { preferred: TermHit[]; forbidden: TermHit[] } {
  const forbidden = hits.filter((hit) => hit.isForbidden);
  const best = new Map<string, TermHit>();

  for (const hit of hits) {
    if (hit.isForbidden) continue;
    const key = hit.sourceText.toLowerCase();
    const current = best.get(key);
    if (!current || scopeRank(hit.scopeType) > scopeRank(current.scopeType)) best.set(key, hit);
  }

  return { preferred: [...best.values()], forbidden };
}

export async function lookupTerms(query: {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  clientId?: string | null;
  sectorId?: string | null;
}): Promise<{ preferred: TermHit[]; forbidden: TermHit[] }> {
  const { data, error } = await getCeviriSupabase().rpc("lookup_terms", {
    p_text: normalizeForMatch(query.sourceText, query.sourceLang),
    p_source_lang: query.sourceLang,
    p_target_lang: query.targetLang,
    p_client_id: query.clientId ?? null,
    p_sector_id: query.sectorId ?? null,
  });

  if (error) throw new Error(`lookup_terms failed: ${error.message}`);

  const hits: TermHit[] = (data ?? []).map((row: Record<string, unknown>) => ({
    conceptId: row.concept_id as string,
    scopeType: row.scope_type as string,
    sourceText: row.source_text as string,
    targetText: row.target_text as string,
    isForbidden: row.is_forbidden as boolean,
    notes: (row.notes as string | null) ?? null,
  }));

  return pickWinners(hits);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-term-resolve.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Verify against the imported terms**

```bash
node --import tsx -e '
import { lookupTerms } from "./lib/ceviri/term-store.ts";
const out = await lookupTerms({
  sourceText: "The registration and the trade name of the product",
  sourceLang: "en-US", targetLang: "tr-TR",
});
console.log("zorunlu:", out.preferred.map((h) => [h.sourceText, h.targetText]));
console.log("yasaklı:", out.forbidden.map((h) => h.targetText));
'
```

Expected: içe aktarılan terminolojide geçen kelimeler için karşılıklar listelenir.
Boş dönüyorsa `select count(*) from term_variants where lang = 'en-US';` ile veriyi doğrulayın.

- [ ] **Step 7: Commit**

```bash
git add lib/ceviri/term-store.ts tests/ceviri-term-resolve.test.ts \
        supabase/ceviri/migrations/202609190003_term_lookup.sql
git commit -m "Çeviri: katmanlı terim çözümleme"
```

---

### Task 9: Arama arayüzü

Faz 0'ın teslimatı: "Terim ve cümle sorgulanabilir." Mevcut `/ceviri-app` inşaat sayfasına dokunulmaz; arama `/ceviri-app/arama` altına konur.

**Files:**
- Create: `lib/ceviri/search-request.ts`
- Create: `app/api/ceviri/search/route.ts`
- Create: `app/ceviri-app/arama/page.tsx`
- Create: `app/ceviri-app/arama/search-client.tsx`
- Test: `tests/ceviri-search-request.test.ts`

**Interfaces:**
- Consumes: `searchTm` (Task 7), `lookupTerms` (Task 8), `requireAdminSession` (mevcut `lib/auth.ts`)
- Produces:
  - `parseSearchBody(body: unknown): { sourceText: string; sourceLang: string; targetLang: string } | { error: string }`
  - `POST /api/ceviri/search` → `{ matches: TmMatch[]; terms: { preferred: TermHit[]; forbidden: TermHit[] } }`

> **Neden ayrı dosya:** Girdi doğrulaması `lib/ceviri/search-request.ts` içine konur, route
> onu çağırır. Böylece test `next/server` yüklemek zorunda kalmaz. Kod tabanı bu deseni
> zaten kullanıyor — `lib/qr-request-origin.ts` saf modüldür ve `tests/qr-request-origin.test.ts`
> onu doğrudan test eder.
>
> **Oturum:** `requireAdminSession()` argüman almaz ve yetkisizse `Error("UNAUTHORIZED")`
> fırlatır. Route onu yakalayıp 401 döner — `app/api/jobs/route.ts:48-50` ile aynı biçimde.

- [ ] **Step 1: Write the failing test**

`tests/ceviri-search-request.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseSearchBody } from "../lib/ceviri/search-request.ts";

test("accepts a complete request", () => {
  assert.deepEqual(
    parseSearchBody({ sourceText: "Trade name", sourceLang: "en-US", targetLang: "tr-TR" }),
    { sourceText: "Trade name", sourceLang: "en-US", targetLang: "tr-TR" },
  );
});

test("trims the query text", () => {
  const parsed = parseSearchBody({ sourceText: "  Trade name  ", sourceLang: "en-US", targetLang: "tr-TR" });
  assert.deepEqual(parsed, { sourceText: "Trade name", sourceLang: "en-US", targetLang: "tr-TR" });
});

test("rejects an empty or whitespace only query", () => {
  assert.deepEqual(parseSearchBody({ sourceText: "   ", sourceLang: "en-US", targetLang: "tr-TR" }), { error: "sourceText is required." });
});

test("rejects a missing language", () => {
  assert.deepEqual(parseSearchBody({ sourceText: "x", sourceLang: "", targetLang: "tr-TR" }), { error: "sourceLang is required." });
  assert.deepEqual(parseSearchBody({ sourceText: "x", sourceLang: "en-US", targetLang: "" }), { error: "targetLang is required." });
});

test("rejects a non object body", () => {
  assert.deepEqual(parseSearchBody(null), { error: "Body must be an object." });
  assert.deepEqual(parseSearchBody("nope"), { error: "Body must be an object." });
});

test("caps the query length so one request cannot scan the whole memory", () => {
  const parsed = parseSearchBody({ sourceText: "a".repeat(5001), sourceLang: "en-US", targetLang: "tr-TR" });
  assert.deepEqual(parsed, { error: "sourceText must be 5000 characters or fewer." });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ceviri-search-request.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/search-request.ts'`

- [ ] **Step 3: Write the pure request parser**

`lib/ceviri/search-request.ts`:

```ts
const MAX_QUERY = 5000;

export type SearchQuery = { sourceText: string; sourceLang: string; targetLang: string };

export function parseSearchBody(body: unknown): SearchQuery | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Body must be an object." };
  const input = body as Record<string, unknown>;

  const sourceText = typeof input.sourceText === "string" ? input.sourceText.trim() : "";
  const sourceLang = typeof input.sourceLang === "string" ? input.sourceLang.trim() : "";
  const targetLang = typeof input.targetLang === "string" ? input.targetLang.trim() : "";

  if (!sourceText) return { error: "sourceText is required." };
  if (sourceText.length > MAX_QUERY) return { error: `sourceText must be ${MAX_QUERY} characters or fewer.` };
  if (!sourceLang) return { error: "sourceLang is required." };
  if (!targetLang) return { error: "targetLang is required." };

  return { sourceText, sourceLang, targetLang };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ceviri-search-request.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Write the route**

`app/api/ceviri/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { parseSearchBody } from "../../../../lib/ceviri/search-request";
import { searchTm } from "../../../../lib/ceviri/tm-store";
import { lookupTerms } from "../../../../lib/ceviri/term-store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    await requireAdminSession();

    const parsed = parseSearchBody(await request.json().catch(() => null));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const [matches, terms] = await Promise.all([searchTm(parsed), lookupTerms(parsed)]);
    return NextResponse.json({ matches, terms });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Arama başarısız." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 6: Write the page**

`app/ceviri-app/arama/search-client.tsx`:

```tsx
"use client";

import { useState } from "react";

type TmMatch = { id: string; source_text: string; target_text: string; score: number; origin: string; project_names: string[] };
type TermHit = { conceptId: string; scopeType: string; sourceText: string; targetText: string; isForbidden: boolean };
type Result = { matches: TmMatch[]; terms: { preferred: TermHit[]; forbidden: TermHit[] } };

export default function SearchClient() {
  const [sourceText, setSourceText] = useState("");
  const [sourceLang, setSourceLang] = useState("en-US");
  const [targetLang, setTargetLang] = useState("tr-TR");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ceviri/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceText, sourceLang, targetLang }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Arama başarısız.");
      setResult(payload as Result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Arama başarısız.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={run}>
        <textarea
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          placeholder="Aranacak cümle veya terim"
          rows={3}
          required
        />
        <div>
          <input value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} aria-label="Kaynak dil" />
          <span> → </span>
          <input value={targetLang} onChange={(e) => setTargetLang(e.target.value)} aria-label="Hedef dil" />
          <button type="submit" disabled={busy}>{busy ? "Aranıyor…" : "Ara"}</button>
        </div>
      </form>

      {error && <p role="alert">{error}</p>}

      {result && (
        <>
          <h2>Terimler</h2>
          {result.terms.forbidden.length > 0 && (
            <ul>
              {result.terms.forbidden.map((hit) => (
                <li key={`f-${hit.conceptId}`}><strong>YASAKLI:</strong> {hit.sourceText} → {hit.targetText}</li>
              ))}
            </ul>
          )}
          <ul>
            {result.terms.preferred.map((hit) => (
              <li key={hit.conceptId}>{hit.sourceText} → {hit.targetText} <small>({hit.scopeType})</small></li>
            ))}
          </ul>
          {result.terms.preferred.length === 0 && result.terms.forbidden.length === 0 && <p>Terim bulunamadı.</p>}

          <h2>Çeviri belleği</h2>
          {result.matches.length === 0 && <p>Eşleşme bulunamadı.</p>}
          <ol>
            {result.matches.map((match) => (
              <li key={match.id}>
                <div><strong>%{Math.round(match.score * 100)}</strong> — {match.origin}</div>
                <div>{match.source_text}</div>
                <div>{match.target_text}</div>
                {match.project_names.length > 0 && <small>{match.project_names.join(", ")}</small>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
```

`app/ceviri-app/arama/page.tsx`:

```tsx
import Link from "next/link";
import CompanySwitcher from "../../company-switcher";
import SearchClient from "./search-client";

export const metadata = { title: "Bellek ve Terim Arama | Çeviri APP" };

export default function CeviriSearchPage() {
  return (
    <div lang="tr">
      <header className="studio-header">
        <CompanySwitcher current="translation" />
        <Link href="/ceviri-app">← Çeviri APP</Link>
      </header>
      <main>
        <h1>Bellek ve Terim Arama</h1>
        <p>Çeviri belleğinde ve terminolojide arama yapın.</p>
        <SearchClient />
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Check it in the browser**

```bash
npm run dev
```

`http://localhost:3000/ceviri-app/arama` adresini açın, giriş yapın.
`Trade name` / `en-US` → `tr-TR` sorgulayın.

Expected: Terimler bölümünde karşılıklar, Çeviri belleği bölümünde skorlu eşleşmeler.

Giriş yapmış olmanıza rağmen 401 alıyorsanız oturum çerezi route'a ulaşmıyordur;
`app/api/jobs/route.ts` ile karşılaştırın (aynı `requireAdminSession()` çağrısını kullanır).

- [ ] **Step 8: Run the whole suite**

```bash
node --import tsx --test tests/ceviri-*.test.ts
npm run lint
```

Expected: tüm çeviri testleri geçer, lint temiz.

- [ ] **Step 9: Commit**

```bash
git add lib/ceviri/search-request.ts app/api/ceviri app/ceviri-app/arama \
        tests/ceviri-search-request.test.ts
git commit -m "Çeviri: bellek ve terim arama arayüzü"
```

---

## Faz 0 tamamlanma ölçütleri

- [ ] 38 TMX dosyasının tamamı içe aktarıldı; `imports` tablosunda her biri `succeeded`.
- [ ] `select count(*) from tm_segments;` sonucu 136.745'ten **belirgin biçimde az** — örtüşen ihraçlar tekilleştirildi.
- [ ] 4 terminoloji xlsx'i içe aktarıldı.
- [ ] `/ceviri-app/arama` birebir ve bulanık eşleşme döndürüyor.
- [ ] Yasaklı terim sorgusu ayrı listede görünüyor.
- [ ] `node --import tsx --test tests/ceviri-*.test.ts` geçiyor.

## Faz 0'da kasıtlı olarak yapılmayanlar

Bunlar sonraki fazlara aittir; Faz 0'da eklemeyin:

- Belge yükleme, OCR, segmentasyon (Faz 1)
- `documents`, `document_blocks`, `segments` tabloları (Faz 1)
- `rules`, `rule_candidates` tabloları (Faz 3)
- `reference_documents`, `reference_chunks`, `doc_templates` (Faz 3)
- Çeviri motoru çağrıları (Faz 1-2)
- Kullanıcı yönetimi — mevcut tek admin oturumu kullanılır
