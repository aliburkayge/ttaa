import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getCeviriSupabase } from "../../../../lib/ceviri/supabase";
import { createClient, libraryStats, listClients, parseAliases } from "../../../../lib/ceviri/clients";

export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Firma listesi, kütüphane sayılarıyla; karar bekleyen proje sayısı. */
export async function GET() {
  try {
    await requireAdminSession();
    const [clients, stats, pending] = await Promise.all([
      listClients(),
      libraryStats(),
      getCeviriSupabase().from("project_clients").select("project_name", { count: "exact", head: true }).eq("pending", true),
    ]);
    const empty = { memory: 0, terms: 0, documents: 0, suggestions: 0 };
    return NextResponse.json({
      clients: clients.map((client) => ({ ...client, stats: stats.get(client.id) ?? empty })),
      pendingProjects: pending.count ?? 0,
    });
  } catch (error) {
    return failure(error, "Firmalar okunamadı.");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const body = (await request.json().catch(() => null)) as { name?: unknown; aliases?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    const aliases = typeof body?.aliases === "string" ? parseAliases(body.aliases) : [];
    const client = await createClient({ name, aliases });
    return NextResponse.json({ client });
  } catch (error) {
    return failure(error, "Firma oluşturulamadı.");
  }
}
