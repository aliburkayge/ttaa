/**
 * Çıktı PDF'lerinin kalite ölçümü (bkz. lib/ceviri/pdf-audit.ts).
 *
 * Usage: npm run ceviri:pdf-audit -- <manifest.json> <çıktı-klasörü> [hazır-çıktılar-klasörü]
 *
 * Üçüncü argüman verilirse çıktı üretilmez, o klasördeki `<name>.pdf` ölçülür
 * (ör. eski bir sürümün çıktıları); bölgeler yine güncel plandan gelir.
 *
 * manifest: [{ "name": "nj", "original": "…/orijinal.pdf", "cache": "…/nj.json" }]
 * cache   : { blocks: LayoutBlock[], segments: [{ id, text, translation }], targetLang }
 *           — yüklenmiş belgenin OCR düzeni ve çevirileri.
 *
 * Belge, indirmedeki yoldan geçer (planOverlay → renderOverlay). İmza/mühür
 * kararı, önbellekte yüklemedeki plan (`overlay`, üretim sınıflandırıcısının
 * kararları) varsa aynı yerdeki karardan, yoksa yerel bir sezgiden gelir:
 * ölçüm hiçbir dış servise görüntü göndermez. Sonuç: belge × kusur türü tablosu, `summary.json` ve her
 * kusurun önce/sonra kırpıntısı.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { fontsFor } from "../lib/ceviri/fonts";
import { auditPage, type AuditZones, type Defect, type PixelBox } from "../lib/ceviri/pdf-audit";
import { frameFor, itemAction, itemChanged, itemContent, layoutItemText, markObstacles, planOverlay, renderOverlay, type OverlayPlan, type Rect } from "../lib/ceviri/pdf-overlay";
import type { ImageKind, LayoutBlock } from "../lib/ceviri/ocr-layout";
import { pageGeometry, renderPdfPage } from "../lib/ceviri/pdf-scan";

const [manifestPath, outDir, readyDir] = process.argv.slice(2);
if (!manifestPath || !outDir) throw new Error("manifest.json ve çıktı klasörü gerekli.");
mkdirSync(outDir, { recursive: true });

type Entry = { name: string; original: string; cache: string };
type Cache = {
  blocks: LayoutBlock[];
  overlay?: OverlayPlan | null;
  segments: Array<{ id: string; text: string; translation: string | null }>;
  targetLang: string;
};

/** Ölçüm çözünürlüğü: punto başına piksel. */
const S = 3;

/**
 * Üretimin kararı: yüklemedeki planda aynı yere (en az yarısı örtüşen) bir
 * işaret konmuşsa o tür, konmamışsa işaret değil.
 */
function recorded(stored: OverlayPlan) {
  return async (_dataUrl: string, where?: { page: number; rect: Rect }): Promise<ImageKind> => {
    if (!where) return "text";
    const area = (r: Rect) => Math.max(0, r.u1 - r.u0) * Math.max(0, r.v1 - r.v0);
    const hit = stored.items.find((item) => {
      if (!item.mark || item.page !== where.page) return false;
      const overlap = area({
        u0: Math.max(item.area.u0, where.rect.u0),
        v0: Math.max(item.area.v0, where.rect.v0),
        u1: Math.min(item.area.u1, where.rect.u1),
        v1: Math.min(item.area.v1, where.rect.v1),
      });
      return overlap >= 0.5 * Math.min(area(item.area), area(where.rect));
    });
    return hit?.mark ?? "text";
  };
}

/** Yerel imza/mühür sezgisi: mavi/lacivert imza, yeşil-turkuaz mühür, sarı fotoğraf. */
async function heuristic(dataUrl: string): Promise<ImageKind> {
  const { data, info } = await sharp(Buffer.from(dataUrl.split(",")[1], "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let blue = 0;
  let teal = 0;
  let yellow = 0;
  let dark = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    const c = Math.max(r, g, b) - Math.min(r, g, b);
    if (c < 45) {
      if (r + g + b < 300) dark++;
      continue;
    }
    if (b > r + 30 && b >= g) blue++;
    else if (g > r + 25 && b > r) teal++;
    else if (r > b + 40 && g > b + 40) yellow++;
  }
  const wPt = info.width * 0.35;
  const hPt = info.height * 0.35;
  if (yellow > blue + teal) return "photo";
  if (teal > blue && teal > 30) return "stamp";
  if (blue > 30) return hPt < 12 ? "text" : "signature";
  return wPt > 100 && hPt / wPt > 0.3 && dark > 200 ? "signature" : hPt / wPt < 0.3 ? "logo" : "text";
}

async function raster(bytes: Uint8Array, index: number, width: number, height: number) {
  const rgba = await renderPdfPage(bytes, index, { width, height });
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return { w: width, h: height, rgb };
}

async function crop(pixels: { w: number; h: number; rgb: Uint8Array }, box: PixelBox) {
  const pad = 15 * S;
  const left = Math.max(0, Math.floor(box.x0 - pad));
  const top = Math.max(0, Math.floor(box.y0 - pad));
  const width = Math.min(pixels.w - left, Math.ceil(box.x1 + pad) - left);
  const height = Math.min(pixels.h - top, Math.ceil(box.y1 + pad) - top);
  return sharp(Buffer.from(pixels.rgb), { raw: { width: pixels.w, height: pixels.h, channels: 3 } })
    .extract({ left, top, width, height })
    .png()
    .toBuffer({ resolveWithObject: true });
}

const KINDS: Defect["kind"][] = ["rule", "text", "residue", "patch", "label"];
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Entry[];
const summary: Record<string, Record<string, number>> = {};
const details: Array<{ doc: string; page: number } & Defect> = [];

for (const entry of manifest) {
  const bytes = new Uint8Array(readFileSync(entry.original));
  const cache = JSON.parse(readFileSync(entry.cache, "utf8")) as Cache;
  const plan = await planOverlay(bytes, cache.blocks, { classify: cache.overlay ? recorded(cache.overlay) : heuristic });
  const texts = new Map(cache.segments.map((segment) => [segment.id, { source: segment.text, translation: segment.translation }]));
  const output = readyDir
    ? new Uint8Array(readFileSync(join(readyDir, `${entry.name}.pdf`)))
    : await renderOverlay(bytes, plan, texts, { targetLang: cache.targetLang });
  if (!readyDir) writeFileSync(join(outDir, `${entry.name}.pdf`), output);

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const fontFor = fontsFor(await PDFDocument.create());
  const counts: Record<string, number> = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  for (let index = 0; index < doc.getPageCount(); index++) {
    const geometry = pageGeometry(doc.getPage(index));
    const width = Math.round(geometry.width * S);
    const height = Math.round(geometry.height * S);
    const straight = frameFor(geometry, plan.pages[index]?.skew ?? 0);
    const toBox = (rect: Rect): PixelBox => {
      const corners = [
        straight.toDisplay(rect.u0, rect.v0),
        straight.toDisplay(rect.u1, rect.v0),
        straight.toDisplay(rect.u0, rect.v1),
        straight.toDisplay(rect.u1, rect.v1),
      ];
      return {
        x0: Math.min(...corners.map((c) => c.u)) * S,
        y0: Math.min(...corners.map((c) => c.v)) * S,
        x1: Math.max(...corners.map((c) => c.u)) * S,
        y1: Math.max(...corners.map((c) => c.v)) * S,
      };
    };

    const zones: AuditZones = { marks: [], labels: [], protect: [], markPatches: [], editable: [], exempt: [], drawn: [] };
    for (const item of plan.items.filter((each) => each.page === index + 1)) {
      const lines = item.lineIds.map((id) => texts.get(id));
      const patches = [...item.erase, ...item.masks.map((mask) => mask.rect)].map(toBox);
      // Dokunulmayan ve orijinal mürekkebi geri konan satırlar: pikselleri değişmemeli.
      if (itemAction(item, lines) !== "rewrite") {
        zones.protect.push(toBox(item.area));
        continue;
      }
      const font = await fontFor(item.family ?? "serif", item.bold);
      const laid = layoutItemText(item, itemContent(item, lines, cache.targetLang), font, item.mark ? markObstacles(plan, item) : []);
      const boxes = laid.lines
        .filter((line) => line.text.trim())
        .map((line) => toBox({ u0: line.p, v0: line.baseline - laid.size * 0.75, u1: line.p + line.width, v1: line.baseline + laid.size * 0.25 }));
      if (item.mark) {
        zones.marks.push({ box: toBox(item.area), kind: item.mark });
        zones.markPatches.push(...patches);
        zones.labels.push(...boxes);
      } else {
        zones.editable.push(...patches);
        zones.drawn.push(...boxes);
        if (item.underline) zones.exempt.push(...patches);
      }
    }

    const before = await raster(bytes, index, width, height);
    const after = await raster(output, index, width, height);
    const defects = auditPage(before, after, S, zones);
    // Çevrilmeyen satır OCR metninden yeniden yazılmışsa (imza ısırdığı için):
    // OCR hatası belgeye geçer, satır yer değiştirebilir.
    for (const item of plan.items.filter((each) => each.page === index + 1 && !each.mark && each.redraw)) {
      const lines = item.lineIds.map((id) => texts.get(id));
      if (itemChanged(lines) || itemAction(item, lines) !== "rewrite") continue;
      defects.push({
        kind: "text",
        box: toBox(item.area),
        amount: 1,
        note: `çevrilmeyen satır OCR'dan yeniden yazıldı: "${lines.map((line) => line?.source ?? "").join(" ")}"`,
      });
    }
    for (const [k, defect] of defects.entries()) {
      counts[defect.kind]++;
      details.push({ doc: entry.name, page: index + 1, ...defect });
      const left = await crop(before, defect.box);
      const right = await crop(after, defect.box);
      const gap = 12;
      await sharp({
        create: { width: left.info.width + right.info.width + gap, height: Math.max(left.info.height, right.info.height), channels: 3, background: "#ff00ff" },
      })
        .composite([
          { input: left.data, left: 0, top: 0 },
          { input: right.data, left: left.info.width + gap, top: 0 },
        ])
        .png()
        .toFile(join(outDir, `${entry.name}-s${index + 1}-${defect.kind}-${k + 1}.png`));
    }
  }
  summary[entry.name] = counts;
  console.log(`${entry.name.padEnd(12)} ${KINDS.map((kind) => `${kind} ${counts[kind]}`).join("  ")}`);
}

const totals = Object.fromEntries(KINDS.map((kind) => [kind, Object.values(summary).reduce((sum, counts) => sum + counts[kind], 0)]));
console.log(`${"TOPLAM".padEnd(12)} ${KINDS.map((kind) => `${kind} ${totals[kind]}`).join("  ")}`);
for (const detail of details) console.log(`  ${detail.doc} s.${detail.page} ${detail.kind.padEnd(7)} ${detail.note}`);
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ summary, totals, details }, null, 2));
