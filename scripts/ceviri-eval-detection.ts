/**
 * Firma tespitinin eski arşivde ölçümü (spec 5.2 kabul ölçütü: otomatik
 * kararların ≥ %95'i doğru, "sor" ≤ %30).
 *
 * Usage: npm run ceviri:eval-detection -- <tmx-klasörü> <firma-gruplari.tsv>
 *
 * Firması belli projeler 5 parçaya bölünür; her turda 4 parçadan parmak izi,
 * "firmanın uzun cümleleri" ve adın güvenilirliği öğrenilir, 5. parça
 * sınıflandırılır. Proje adı kullanılmaz: yalnızca metin.
 *
 * İki etiket kümesi raporlanır: bütün etiketler ve yalnızca proje adından
 * gelen (güçlü) etiketler. Metinden gelen "bayer" etiketlerinin bir kısmı
 * aslında Nase'nin işleridir (Nase, Bayer ürünleri de satıyor); onlarla
 * ölçülen doğruluk gerçekte olduğundan düşük görünür.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildSignatures } from "../lib/ceviri/signatures";
import { DETECTION, decide, nameHits, nameReliability, scoreClients, signatureHits, type ScoredClient } from "../lib/ceviri/detect-client";
import { tokensOf } from "../lib/ceviri/fold";
import { DEFAULT_ALIASES } from "../lib/ceviri/project-firms";

const [root, labelsPath] = process.argv.slice(2);
if (!root || !labelsPath) throw new Error("TMX klasörü ve firma-gruplari.tsv gerekli.");

const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".tmx")) files.push(path);
  }
})(root);

const unescape = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const projects = new Map<string, { name: string; sources: Set<string> }>();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/<tu [\s\S]*?<\/tu>/g)) {
    const tu = match[0];
    const pid = /type="x-project_id">([^<]*)</.exec(tu)?.[1] ?? "?";
    const name = /type="x-project_name">([^<]*)</.exec(tu)?.[1] ?? "";
    const seg = /<seg>([\s\S]*?)<\/seg>/.exec(tu)?.[1];
    if (!seg) continue;
    const project = projects.get(pid) ?? { name, sources: new Set<string>() };
    project.sources.add(unescape(seg).trim());
    projects.set(pid, project);
  }
}

// Ölçülen firmalar: sistemde kaydı olanlar. Diğer küçük üreticiler genelde kalır.
const known = new Set(Object.keys(DEFAULT_ALIASES));
const labels = new Map<string, { firm: string; strong: boolean }>();
for (const line of readFileSync(labelsPath, "utf8").replace(/\r/g, "").trim().split("\n").slice(1)) {
  const [firm, reason, pid] = line.split("\t");
  if (known.has(firm) && projects.has(pid)) labels.set(pid, { firm, strong: reason === "proje adı" });
}
const clients = Object.entries(DEFAULT_ALIASES).map(([id, preset]) => ({ id, name: preset.name, aliases: preset.aliases }));
const labeled = [...labels.keys()].sort();
const K = 5;

type Outcome = { pid: string; truth: string; strong: boolean; scored: ScoredClient[]; names: Map<string, number> };
const outcomes: Outcome[] = [];
const weights: string[] = [];

for (let part = 0; part < K; part++) {
  const test = labeled.filter((_, index) => index % K === part);
  const train = new Set(labeled.filter((_, index) => index % K !== part));
  const docs = [...projects].map(([pid, project]) => ({ clientId: train.has(pid) ? labels.get(pid)!.firm : null, texts: [...project.sources] }));
  const signatures = buildSignatures(docs).map((s) => ({ client_id: s.clientId, token: s.token, weight: s.weight }));
  // Adın güvenilirliği de yalnızca eğitim projelerinden öğrenilir.
  const nameWeight = nameReliability(
    [...train].map((pid) => ({ clientId: labels.get(pid)!.firm, names: nameHits([...projects.get(pid)!.sources].join("\n"), clients) })),
  );
  weights.push([...nameWeight].map(([k, v]) => `${k}:${v.toFixed(2)}`).join(" "));
  const owner = new Map<string, string>();
  for (const pid of train) {
    for (const sentence of projects.get(pid)!.sources) {
      if (sentence.length < 30) continue;
      const seen = owner.get(sentence);
      owner.set(sentence, seen && seen !== labels.get(pid)!.firm ? "*" : labels.get(pid)!.firm);
    }
  }
  for (const pid of test) {
    const texts = [...projects.get(pid)!.sources];
    const names = nameHits(texts.join("\n"), clients);
    const memory = new Map<string, number>();
    for (const sentence of texts) {
      const firm = owner.get(sentence);
      if (firm && firm !== "*") memory.set(firm, (memory.get(firm) ?? 0) + 1);
    }
    const tokens = [...new Set(texts.flatMap(tokensOf))];
    const scored = scoreClients({ names, signature: signatureHits(tokens, signatures), memory, nameWeight });
    outcomes.push({ pid, truth: labels.get(pid)!.firm, strong: labels.get(pid)!.strong, scored, names });
  }
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");

function evaluate(rules: typeof DETECTION, set: Outcome[]) {
  const tally = { auto: 0, autoRight: 0, suggest: 0, suggestRight: 0, ask: 0 };
  const confusion = new Map<string, number>();
  for (const outcome of set) {
    const detection = decide(outcome.scored, outcome.names, rules);
    if (detection.decision === "auto") {
      tally.auto++;
      if (detection.clientId === outcome.truth) tally.autoRight++;
      else confusion.set(`${outcome.truth}→${detection.clientId}`, (confusion.get(`${outcome.truth}→${detection.clientId}`) ?? 0) + 1);
    } else if (detection.decision === "suggest") {
      tally.suggest++;
      if (detection.clientId === outcome.truth) tally.suggestRight++;
    } else tally.ask++;
  }
  return { tally, confusion, total: set.length };
}

function report(title: string, rules: typeof DETECTION, set: Outcome[]) {
  const { tally, confusion, total } = evaluate(rules, set);
  console.log(`\n${title} — ${total} proje`);
  console.log(`  Otomatik: ${tally.auto} (${pct(tally.auto, total)}), doğruluk ${pct(tally.autoRight, tally.auto)}`);
  console.log(`  Öneri:    ${tally.suggest} (${pct(tally.suggest, total)}), doğruluk ${pct(tally.suggestRight, tally.suggest)}`);
  console.log(`  Sor:      ${tally.ask} (${pct(tally.ask, total)})`);
  console.log(`  Otomatik hatalar: ${[...confusion].map(([k, v]) => `${k}:${v}`).join(", ") || "yok"}`);
}

const strong = outcomes.filter((outcome) => outcome.strong);
console.log("Ad güvenilirliği (turlar):");
for (const line of weights) console.log(`  ${line}`);
report("Varsayılan kural, bütün etiketler", DETECTION, outcomes);
report("Varsayılan kural, proje adından gelen etiketler", DETECTION, strong);

console.log(
  "\nEşik taraması: otomatik eşiği / pay / bellek yoksa gereken puan → güçlü etiketlerde doğruluk, otomatik, sor | bütün etiketlerde doğruluk",
);
for (const auto of [6, 8, 10, 12]) {
  for (const autoMargin of [2, 3]) {
    for (const autoWithoutMemory of [Infinity, 20, 15]) {
      const rules = { ...DETECTION, auto, autoMargin, autoWithoutMemory };
      const { tally, total } = evaluate(rules, strong);
      const all = evaluate(rules, outcomes);
      console.log(
        `  ${String(auto).padStart(2)} / ${String(autoMargin).padEnd(2)} / ${String(autoWithoutMemory).padEnd(8)} → ${pct(tally.autoRight, tally.auto).padStart(6)}  otomatik ${pct(tally.auto, total).padStart(6)}  sor ${pct(tally.ask, total).padStart(6)} | ${pct(all.tally.autoRight, all.tally.auto)}`,
      );
    }
  }
}
