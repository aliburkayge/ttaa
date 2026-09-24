/**
 * Eski belleği firmalara dağıtır (spec 5.3).
 *
 * Usage: npm run ceviri:backfill-clients -- <firma-gruplari.tsv> <belirsiz-siniflandirma.tsv> [--apply]
 *
 * Varsayılan kuru çalışmadır: firma kayıtlarını ve proje eşlemesini yazar
 * (ikisi de geri alınabilir), bellek satırlarına dokunmadan hangi firmaya kaç
 * satır düşeceğini gösterir. `--apply` satırları günceller.
 */
import nextEnv from "@next/env";
import { readFile } from "node:fs/promises";

nextEnv.loadEnvConfig(process.cwd());

import { getCeviriSupabase } from "../lib/ceviri/supabase";
import { DEFAULT_ALIASES, readScanTables } from "../lib/ceviri/project-firms";

/** Bundan az cümlesi olan üretici için ayrı firma açılmaz; projeleri genelde kalır. */
const MIN_SENTENCES = 1000;

async function main() {
  const [groupsPath, unresolvedPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!groupsPath || !unresolvedPath) throw new Error("İki tarama tablosu gerekli (bkz. Usage).");
  const apply = process.argv.includes("--apply");
  const supabase = getCeviriSupabase();

  const decisions = readScanTables(await readFile(groupsPath, "utf8"), await readFile(unresolvedPath, "utf8"));
  const totals = new Map<string, number>();
  for (const decision of decisions) if (decision.firm) totals.set(decision.firm, (totals.get(decision.firm) ?? 0) + decision.sentences);
  const firms = [...totals].filter(([, sentences]) => sentences >= MIN_SENTENCES).map(([slug]) => slug);
  console.log("Firmalar:", [...totals].map(([slug, n]) => `${slug}=${n}${firms.includes(slug) ? "" : " (genel)"}`).join(", "));

  const { data: sector } = await supabase.from("sectors").select("id").eq("slug", "zirai-ilac").maybeSingle();
  const ids = new Map<string, string>();
  for (const slug of firms) {
    const preset = DEFAULT_ALIASES[slug] ?? { name: slug, aliases: [] };
    const { data: existing } = await supabase.from("clients").select("id, aliases").eq("slug", slug).maybeSingle();
    if (existing) {
      const aliases = [...new Set([...(existing.aliases as string[]), ...preset.aliases])];
      const { error } = await supabase.from("clients").update({ aliases, default_sector_id: sector?.id ?? null }).eq("id", existing.id);
      if (error) throw new Error(`${slug} güncellenemedi: ${error.message}`);
      ids.set(slug, existing.id as string);
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert({ slug, name: preset.name, aliases: preset.aliases, default_sector_id: sector?.id ?? null })
        .select("id")
        .single();
      if (error) throw new Error(`${slug} oluşturulamadı: ${error.message}`);
      ids.set(slug, data.id as string);
    }
  }

  const rows = decisions.map((decision) => ({
    project_name: decision.name,
    client_id: decision.firm && ids.has(decision.firm) ? ids.get(decision.firm)! : null,
    decided_by: decision.decidedBy,
    pending: decision.pending,
    evidence: { ...decision.evidence, sentences: decision.sentences, firm: decision.firm },
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("project_clients").upsert(rows.slice(i, i + 500), { onConflict: "project_name" });
    if (error) throw new Error(`project_clients yazılamadı: ${error.message}`);
  }
  console.log(`${rows.length} proje eşlendi; ${rows.filter((r) => r.pending).length} karar bekliyor.`);

  const names = new Map([...ids].map(([slug, id]) => [id, slug]));
  const totalsByClient = new Map<string | null, number>();
  if (apply) {
    // Tek istekte 73 bin satır PostgREST'in süre sınırına takılıyor: adlar
    // parça parça verilir. Bir satır iki parçada da görülebilir; ikinci
    // seferde değişmediği için iki kez sayılmaz.
    const all = rows.map((row) => row.project_name);
    for (let i = 0; i < all.length; i += 40) {
      const { data, error } = await supabase.rpc("apply_project_clients", { p_names: all.slice(i, i + 40) });
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ client_id: string | null; rows: number }>) {
        totalsByClient.set(row.client_id, (totalsByClient.get(row.client_id) ?? 0) + Number(row.rows));
      }
    }
  } else {
    const { data, error } = await supabase.rpc("preview_project_clients", {});
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ client_id: string | null; rows: number }>) totalsByClient.set(row.client_id, Number(row.rows));
  }
  console.log(apply ? "Güncellenen satırlar:" : "Kuru çalışma — düşecek satırlar:");
  for (const [clientId, count] of totalsByClient) {
    console.log(`  ${clientId ? (names.get(clientId) ?? clientId) : "genel"}: ${count}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
