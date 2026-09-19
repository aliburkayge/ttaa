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
