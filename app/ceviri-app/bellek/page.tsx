import { getCeviriSupabase } from "../../../lib/ceviri/supabase";
import MemoryChat, { type Stats } from "./memory-chat";

export const metadata = { title: "Bellek | Lingua" };
export const dynamic = "force-dynamic";

async function loadStats(): Promise<Stats | null> {
  try {
    // Tek SQL cagrisi: array_length() icin PostgREST filtresi yok, bu yuzden
    // cok projeli sayisi istemci tarafinda turetilemiyor.
    const { data, error } = await getCeviriSupabase().rpc("ceviri_stats");
    if (error || !data?.[0]) return null;
    const row = data[0] as Record<string, number>;
    return {
      segments: Number(row.segments),
      multiProject: Number(row.multi_project),
      concepts: Number(row.concepts),
      variants: Number(row.variants),
      languages: Number(row.languages),
    };
  } catch {
    return null;
  }
}

export default async function MemorySearchPage() {
  return <MemoryChat stats={await loadStats()} />;
}
