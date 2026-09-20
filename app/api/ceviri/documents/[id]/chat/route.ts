import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { runChat, type ChatMessage } from "../../../../../../lib/ceviri/chat";

export const runtime = "nodejs";
export const maxDuration = 120;

type StoredSegment = {
  id: string;
  text: string;
  kind: string;
  order: number;
  translation: string | null;
  source: string | null;
  score: number | null;
  note: string | null;
  warning: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;

    const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "Mesaj boş olamaz." }, { status: 400 });

    const supabase = getCeviriSupabase();
    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("id, filename, source_lang, target_lang, segments, instructions, chat")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const segments = doc.segments as StoredSegment[];
    const history = (doc.chat ?? []) as ChatMessage[];

    const decision = await runChat(
      {
        filename: doc.filename,
        sourceLang: doc.source_lang,
        targetLang: doc.target_lang,
        instructions: doc.instructions ?? null,
        segments: segments.map((segment) => ({
          order: segment.order,
          text: segment.text,
          translation: segment.translation,
          source: segment.source,
          warning: segment.warning,
        })),
      },
      history,
      message,
      process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23",
    );

    const now = new Date().toISOString();
    const chat: ChatMessage[] = [
      ...history,
      { role: "user", content: message, at: now },
      { role: "assistant", content: decision.reply, at: now },
    ];

    // Yeniden çeviri istendiğinde MOTORDAN gelen segmentler temizlenir.
    // Bellekten birebir gelenler olduğu gibi kalır: onlar zaten teslim edilmiş
    // ve onaylanmış metindir, bir talimat yüzünden geri alınmazlar. İnsan
    // düzeltmeleri de aynı sebeple korunur.
    const reset = decision.retranslate;
    const nextSegments = reset
      ? segments.map((segment) =>
          segment.source === "engine" || segment.source === "untouched"
            ? { ...segment, translation: null, source: null, score: null, note: null, warning: null }
            : segment,
        )
      : segments;
    const cleared = reset
      ? nextSegments.filter((segment) => segment.translation === null).length
      : 0;

    const { error: saveError } = await supabase
      .from("ceviri_documents")
      .update({
        chat,
        instructions: decision.instructions ?? doc.instructions ?? null,
        segments: nextSegments,
        updated_at: now,
      })
      .eq("id", id);
    if (saveError) throw new Error(saveError.message);

    return NextResponse.json({
      reply: decision.reply,
      instructions: decision.instructions ?? doc.instructions ?? null,
      retranslate: reset,
      cleared,
      segments: nextSegments,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sohbet başarısız." },
      { status: 500 },
    );
  }
}
