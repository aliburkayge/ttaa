/**
 * Çeviride belge bağlamının ölçümü: gerçek belgeler uygulamanın OCR'ı ve
 * çeviri hattından (bellek → OpenAI + DeepL → hakem → tutarlılık incelemesi)
 * geçirilir, çıktı insan çevirisiyle chrF ile karşılaştırılır.
 *
 * Usage:
 *   npm run ceviri:eval-context -- run <manifest.json> <out-dir> <etiket> [--lines]
 *   npm run ceviri:eval-context -- compare <out-dir> <etiket-a> <etiket-b> [manifest.json]
 *
 * manifest: [{ "name", "source": "<pdf>", "reference": "<docx>", "client"?: "<firma kimliği>" }]
 *
 * Varsayılan, uygulamanın bugünkü yoludur (translate-document.ts: cümleler
 * bütün olarak, çevresindeki metinle). `--lines` eski yol: her OCR satırı tek
 * başına, bağlamsız (24 Eylül 2026 ölçümündeki taban çizgisi).
 *
 * OCR sonucu <out-dir>/cache/<name>.json'da saklanır; sonraki çalıştırmalar
 * OCR'ı yeniden çağırmaz. Firma yüklemedeki gibi belgeden tespit edilir.
 * Veritabanına yazmaz: bellek, terim ve firma yalnızca okunur.
 *
 * Motorlar her çalıştırmada biraz farklı metin üretir. Bir değişikliğin etkisi
 * ancak aynı ayarla iki çalıştırma arasındaki farktan büyükse gerçektir.
 */
import nextEnv from "@next/env";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

nextEnv.loadEnvConfig(process.cwd());

import { activeOcrProvider, ocrToSegments, type OcrResult } from "../lib/ceviri/ocr";
import { parseDocx } from "../lib/ceviri/docx";
import { detectForDocument } from "../lib/ceviri/client-detection-store";
import { scopeFor } from "../lib/ceviri/clients";
import { translateSegment, type TranslatedSegment } from "../lib/ceviri/translate";
import { translatePending } from "../lib/ceviri/translate-document";
import { reviewDocument } from "../lib/ceviri/consistency";
import { askModel } from "../lib/ceviri/llm";
import { chrf, chrfScore, chrfStats } from "../lib/ceviri/chrf";

type Entry = { name: string; source: string; reference: string; client?: string; sourceLang?: string; targetLang?: string };
type RunSegment = {
  id: string;
  text: string;
  translation: string;
  reviewed: string;
  source: string;
  engine: string | null;
  alternatives: Array<{ engine: string; text: string }>;
  warning: string | null;
  unit: string | null;
};
type RunDoc = { name: string; client: string | null; segments: RunSegment[]; before: number; after: number };

/** Çeviri yolunun aynısı: 12'şer segment (bkz. translate route). */
const CHUNK = 12;

function referenceText(path: string): string[] {
  return parseDocx(new Uint8Array(readFileSync(path)))
    .segments.map((segment) => segment.text.trim())
    .filter((text) => text && !/^\[(imza|mühür)\]$/i.test(text));
}

async function ocr(entry: Entry, dir: string): Promise<OcrResult> {
  const cache = join(dir, "cache", `${entry.name}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as OcrResult;
  const provider = activeOcrProvider();
  const result = await provider.run(new Uint8Array(readFileSync(entry.source)), { lang: entry.sourceLang ?? "en-US" });
  if (result.demo) throw new Error("OCR sağlayıcısı yapılandırılmamış (demo).");
  mkdirSync(join(dir, "cache"), { recursive: true });
  writeFileSync(cache, JSON.stringify(result));
  return result;
}

function failed(segment: { id: string; text: string }, cause: unknown): TranslatedSegment {
  return {
    id: segment.id,
    text: segment.text,
    translation: segment.text,
    source: "untouched",
    score: null,
    terms: [],
    forbidden: [],
    note: null,
    warning: `Çeviri başarısız: ${cause instanceof Error ? cause.message : String(cause)}`,
  };
}

async function translateDoc(entry: Entry, dir: string, lines: boolean): Promise<RunDoc> {
  const sourceLang = entry.sourceLang ?? "en-US";
  const targetLang = entry.targetLang ?? "tr-TR";
  const segments = ocrToSegments(await ocr(entry, dir));
  const detection = await detectForDocument(segments.map((segment) => segment.text), sourceLang, entry.client ?? null);
  const { chain, firmInstructions } = await scopeFor({ client_id: detection.clientId, maker_id: detection.makerId });
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23";
  const options = { sourceLang, targetLang, model, scope: chain, firmInstructions };

  const done = new Map<string, TranslatedSegment & { unit?: string | null }>();
  const progress = () => process.stdout.write(`\r  ${entry.name}: ${done.size}/${segments.length}`);
  if (lines) {
    for (let i = 0; i < segments.length; i += CHUNK) {
      const batch = segments.slice(i, i + CHUNK);
      const out = await Promise.all(batch.map((segment) => translateSegment(segment, options).catch((cause) => failed(segment, cause))));
      for (const result of out) done.set(result.id, result);
      progress();
    }
  } else {
    // Çeviri yolunun aynısı: parti parti, her partiden sonra kalan için yeniden.
    while (done.size < segments.length) {
      const state = segments.map((segment) => ({ ...segment, translation: done.get(segment.id)?.translation ?? null }));
      const out = await translatePending(state, {
        ...options,
        document: entry.source.split(/[\\/]/).pop() ?? null,
        limit: CHUNK,
        translate: (segment, opts) => translateSegment(segment, opts).catch((cause) => failed(segment, cause)),
      });
      if (!out.length) break;
      for (const result of out) done.set(result.id, result);
      progress();
    }
  }
  process.stdout.write("\n");
  const results = segments.map((segment) => done.get(segment.id)!);

  const review = await reviewDocument(
    results.map((result) => ({
      id: result.id,
      text: result.text,
      translation: result.translation,
      source: result.source,
      note: result.note,
      unit: result.unit ?? null,
    })),
    { sourceLang, targetLang, ask: askModel },
  );
  const reviewed = new Map(review.segments.map((segment) => [segment.id, segment.translation ?? ""]));
  const reference = referenceText(entry.reference).join("\n");
  const out: RunSegment[] = results.map((result) => ({
    id: result.id,
    text: result.text,
    translation: result.translation,
    reviewed: reviewed.get(result.id) ?? result.translation,
    source: result.source,
    engine: result.engine ?? null,
    alternatives: result.alternatives ?? [],
    warning: result.warning,
    unit: result.unit ?? null,
  }));
  return {
    name: entry.name,
    client: detection.clientId,
    segments: out,
    before: chrf(out.map((segment) => segment.translation).join("\n"), reference),
    after: chrf(out.map((segment) => segment.reviewed).join("\n"), reference),
  };
}

async function run(manifestPath: string, dir: string, label: string, lines: boolean) {
  const entries = JSON.parse(readFileSync(manifestPath, "utf8")) as Entry[];
  mkdirSync(join(dir, label), { recursive: true });
  const docs: RunDoc[] = [];
  for (const entry of entries) {
    const doc = await translateDoc(entry, dir, lines);
    writeFileSync(join(dir, label, `${entry.name}.json`), JSON.stringify(doc, null, 1));
    docs.push(doc);
  }
  console.log(`\n${label}${lines ? " (satır satır, bağlamsız)" : ""}`);
  console.log("belge".padEnd(14), "segment", "motor", "bellek", "cümle", "chrF önce", "chrF sonra");
  for (const doc of docs) {
    const count = (test: (segment: RunSegment) => boolean) => String(doc.segments.filter(test).length);
    console.log(
      doc.name.padEnd(14),
      count(() => true).padStart(7),
      count((segment) => segment.source === "engine").padStart(5),
      count((segment) => segment.source.startsWith("tm-")).padStart(6),
      count((segment) => segment.unit === segment.id).padStart(5),
      doc.before.toFixed(2).padStart(9),
      doc.after.toFixed(2).padStart(10),
    );
  }
  const corpus = (key: "translation" | "reviewed") =>
    chrfScore(
      docs
        .map((doc) =>
          chrfStats(
            doc.segments.map((segment) => segment[key]).join("\n"),
            referenceText(entries.find((entry) => entry.name === doc.name)!.reference).join("\n"),
          ),
        )
        .reduce((sum, stats) => sum.map((value, index) => value + stats[index])),
    );
  console.log("TOPLAM".padEnd(14), " ".repeat(26), corpus("translation").toFixed(2).padStart(9), corpus("reviewed").toFixed(2).padStart(10));
}

/**
 * İki çalıştırmanın farklı çevirdiği yerler, insan çevirisindeki en yakın
 * paragrafla. Birlikte çevrilen cümle tek parça gösterilir (b'nin birimleri).
 */
function compare(dir: string, a: string, b: string, manifestPath?: string) {
  const entries = manifestPath ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Entry[]) : [];
  const out: string[] = [`# ${a} → ${b}`, ""];
  let better = 0;
  let worse = 0;
  for (const file of listJson(join(dir, b))) {
    if (!existsSync(join(dir, a, file))) continue;
    const docA = JSON.parse(readFileSync(join(dir, a, file), "utf8")) as RunDoc;
    const docB = JSON.parse(readFileSync(join(dir, b, file), "utf8")) as RunDoc;
    const entry = entries.find((e) => e.name === docA.name);
    const reference = entry ? referenceText(entry.reference) : [];
    out.push(`## ${docA.name}  chrF ${docA.after.toFixed(2)} → ${docB.after.toFixed(2)}`, "");
    const byIdA = new Map(docA.segments.map((segment) => [segment.id, segment]));
    const groups = new Map<string, RunSegment[]>();
    for (const segment of docB.segments) {
      const key = segment.unit ?? segment.id;
      groups.set(key, [...(groups.get(key) ?? []), segment]);
    }
    for (const members of groups.values()) {
      const source = members.map((segment) => segment.text).join(" ");
      const textA = members.map((segment) => byIdA.get(segment.id)?.reviewed ?? "").join(" ");
      const textB = members.map((segment) => segment.reviewed).join(" ");
      if (textA === textB) continue;
      const closest = reference
        .map((text) => ({ text, score: (chrf(textA, text) + chrf(textB, text)) / 2 }))
        .sort((x, y) => y.score - x.score)[0];
      const scoreA = closest ? chrf(textA, closest.text) : 0;
      const scoreB = closest ? chrf(textB, closest.text) : 0;
      if (scoreB > scoreA + 1) better++;
      if (scoreB < scoreA - 1) worse++;
      out.push(
        `- **EN** ${source}`,
        `  - ${a} (${scoreA.toFixed(0)}): ${textA}`,
        `  - ${b} (${scoreB.toFixed(0)}): ${textB}`,
        ...(closest ? [`  - insan: ${closest.text}`] : []),
        "",
      );
    }
  }
  out.push(`En yakın insan paragrafına göre: ${better} yer iyileşti, ${worse} yer kötüleşti.`);
  const path = join(dir, `fark-${a}-${b}.md`);
  writeFileSync(path, out.join("\n"));
  console.log(`${path}\n${better} iyileşti, ${worse} kötüleşti`);
}

function listJson(path: string): string[] {
  return existsSync(path) ? readdirSync(path).filter((name) => name.endsWith(".json")) : [];
}

async function main() {
  const [command, ...args] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (command === "run" && args.length === 3) return run(args[0], args[1], args[2], process.argv.includes("--lines"));
  if (command === "compare" && args.length >= 3) return compare(args[0], args[1], args[2], args[3]);
  throw new Error("Kullanım için dosyanın başındaki açıklamaya bakın.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
