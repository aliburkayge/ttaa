import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { getClient, libraryStats, parseAliases, updateClient } from "../../../../../lib/ceviri/clients";

export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Firma ayrıntısı; `id` kimlik ya da slug olabilir. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const client = await getClient(decodeURIComponent(id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const stats = (await libraryStats()).get(client.id) ?? { memory: 0, terms: 0, documents: 0, suggestions: 0 };
    return NextResponse.json({ client, stats });
  } catch (error) {
    return failure(error, "Firma okunamadı.");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const existing = await getClient(decodeURIComponent(id));
    if (!existing) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const client = await updateClient(existing.id, {
      name: typeof body?.name === "string" ? body.name : undefined,
      aliases: typeof body?.aliases === "string" ? parseAliases(body.aliases) : undefined,
      instructions: typeof body?.instructions === "string" ? body.instructions : undefined,
    });
    return NextResponse.json({ client });
  } catch (error) {
    return failure(error, "Firma kaydedilemedi.");
  }
}
