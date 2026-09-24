import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { addClientTerm, getClient } from "../../../../../../lib/ceviri/clients";

export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Firmanın terimleri, en yeniden eskiye; `q` kaynak ya da hedef metinde arar. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const q = new URL(request.url).searchParams.get("q")?.trim().toLocaleLowerCase("tr") ?? "";
    const { data, error } = await getCeviriSupabase()
      .from("term_concepts")
      .select("id, created_at, term_variants(lang, text, is_forbidden)")
      .eq("scope_type", "client")
      .eq("scope_id", client.id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const terms = ((data ?? []) as Array<{ id: string; term_variants: Array<{ lang: string; text: string; is_forbidden: boolean }> }>)
      .map((row) => ({ id: row.id, variants: row.term_variants }))
      .filter((term) => !q || term.variants.some((variant) => variant.text.toLocaleLowerCase("tr").includes(q)));
    return NextResponse.json({ terms });
  } catch (error) {
    return failure(error, "Terimler okunamadı.");
  }
}

/** Elle terim: kaynak ve hedef karşılık; `forbidden` ise hedef yasaklı karşılıktır. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const sourceLang = String(body?.sourceLang ?? "en-US");
    const targetLang = String(body?.targetLang ?? "tr-TR");
    const sourceText = String(body?.sourceText ?? "").trim();
    const targetText = String(body?.targetText ?? "").trim();
    const forbidden = body?.forbidden === true;
    if (!sourceText || !targetText) return NextResponse.json({ error: "Kaynak ve hedef terim gerekli." }, { status: 400 });

    const id = await addClientTerm(client.id, { sourceLang, targetLang, sourceText, targetText, forbidden });
    return NextResponse.json({ id });
  } catch (error) {
    return failure(error, "Terim eklenemedi.");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const conceptId = new URL(request.url).searchParams.get("conceptId") ?? "";
    const { error } = await getCeviriSupabase()
      .from("term_concepts")
      .delete()
      .eq("id", conceptId)
      .eq("scope_type", "client")
      .eq("scope_id", client.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return failure(error, "Terim silinemedi.");
  }
}
