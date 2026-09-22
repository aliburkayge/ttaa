import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../lib/ceviri/supabase";

export const runtime = "nodejs";

/** Kayıtlı bir belgeyi açar: sayfa yenilense ya da geri gelinse de iş kaldığı yerden sürer. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const { data, error } = await getCeviriSupabase()
      .from("ceviri_documents")
      .select("id, filename, stats, segments, source_lang, target_lang, status, instructions, chat, ocr:layout->ocr")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const { ocr, ...document } = data as typeof data & {
      ocr: { warning: string | null; provider: string | null; demo: boolean } | null;
    };
    return NextResponse.json({
      document,
      ocrWarning: ocr?.warning ?? null,
      ocrProvider: ocr?.provider ?? null,
      ocrDemo: ocr?.demo === true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Belge açılamadı." },
      { status: 500 },
    );
  }
}
