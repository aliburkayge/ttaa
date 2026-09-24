import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getClient } from "../../../../../../lib/ceviri/clients";
import { decideSuggestion, listSuggestions, runMining } from "../../../../../../lib/ceviri/suggestion-store";

export const runtime = "nodejs";
export const maxDuration = 300;

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    return NextResponse.json({ suggestions: await listSuggestions(client.id) });
  } catch (error) {
    return failure(error, "Öneriler okunamadı.");
  }
}

/** Firmanın belleğinden terim çıkarır. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { sourceLang?: string; targetLang?: string };
    return NextResponse.json(await runMining(client.id, { source: body.sourceLang ?? "en-US", target: body.targetLang ?? "tr-TR" }));
  } catch (error) {
    return failure(error, "Terim çıkarılamadı.");
  }
}

/** Öneri kararı: `accept` (isteğe bağlı düzeltilmiş `targetText` ile) ya da `reject`. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => null)) as { id?: string; action?: string; targetText?: string } | null;
    if (!body?.id || (body.action !== "accept" && body.action !== "reject")) {
      return NextResponse.json({ error: "id ve action (accept|reject) gerekli." }, { status: 400 });
    }
    await decideSuggestion(client.id, body.id, body.action, body.targetText);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return failure(error, "Öneri kaydedilemedi.");
  }
}
