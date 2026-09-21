import type { EngineStatus } from "./engines";
import { askOpenAI } from "./translate";

/**
 * Belge sohbeti.
 *
 * Kullanıcı belgeyi yükledikten sonra serbest metin yazabilir: "başlıkları
 * çevirme", "resmi dil kullan", "14. segment neden kırmızı?" gibi. Bu modül
 * o mesajı iki şeye ayırır:
 *
 *  - `reply`        : kullanıcıya gösterilecek cevap.
 *  - `instructions` : çeviri istemine eklenecek kalıcı talimat (yoksa null).
 *  - `retranslate`  : mevcut çeviriler silinip yeniden üretilmeli mi.
 *
 * Model serbest metin değil, JSON döner; böylece "şunu yap" demesiyle sistemin
 * gerçekten bir şey yapması arasındaki bağ ölçülebilir ve test edilebilir olur.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string; at: string };

export type DocumentContext = {
  /** Gerçekte hangi motorların açık olduğu — sohbet bunu uydurmasın diye. */
  engines: EngineStatus[];
  filename: string;
  sourceLang: string;
  targetLang: string;
  instructions: string | null;
  segments: Array<{
    order: number;
    text: string;
    translation: string | null;
    source: string | null;
    warning: string | null;
  }>;
};

export type ChatDecision = {
  reply: string;
  instructions: string | null;
  retranslate: boolean;
};

/** İsteme sığdırmak için: uzun belgelerde segmentlerin bir kısmı gösterilir. */
const MAX_SEGMENTS_IN_PROMPT = 60;
const MAX_HISTORY = 12;

function engineLines(engines: EngineStatus[]): string[] {
  const extra = engines.filter((engine) => engine.id !== "openai");
  const on = extra.filter((engine) => engine.on).map((engine) => engine.label);
  const off = extra.filter((engine) => !engine.on).map((engine) => engine.label);
  const lines: string[] = [];
  if (on.length) {
    lines.push(
      `- ${on.join(" and ")} also translate the same segments in parallel, as a second opinion.`,
      "- A rule-based referee picks one: candidates using a forbidden term or losing a protected span (registration codes, quantities, dates) are dropped; then agreement between engines wins; then the one using more of the required glossary terms; then OpenAI. The text not chosen is shown to the reviewer as an alternative.",
    );
  }
  if (off.length) lines.push(`- ${off.join(" and ")}: adapter exists but no API key, so it does not run.`);
  return lines;
}

function segmentLines(context: DocumentContext): string[] {
  const shown = context.segments.slice(0, MAX_SEGMENTS_IN_PROMPT);
  const lines = shown.map((segment) => {
    const target = segment.translation ?? "(henüz çevrilmedi)";
    const flag = segment.warning ? ` [UYARI: ${segment.warning}]` : "";
    const origin = segment.source ? ` [${segment.source}]` : "";
    return `${segment.order}. "${segment.text}" -> "${target}"${origin}${flag}`;
  });
  if (context.segments.length > shown.length) {
    lines.push(`… ve ${context.segments.length - shown.length} segment daha (listede gösterilmedi).`);
  }
  return lines;
}

export function buildChatPrompt(
  context: DocumentContext,
  history: ChatMessage[],
  message: string,
): string {
  const translated = context.segments.filter((segment) => segment.translation !== null).length;
  const lines: string[] = [];

  lines.push(
    "You are Lingua, a translation assistant for official regulatory documents.",
    "You answer in Turkish, briefly and concretely. You never invent document content.",
    "",
    "How the system actually works — be accurate about this if asked:",
    "- Every segment first goes to the translation memory (the customer's own past CAT translations).",
    "- A match of 95% or better is reused verbatim. It is text already delivered and approved.",
    "- Anything below that goes to OpenAI, carrying the memory matches and the glossary in the prompt.",
    ...engineLines(context.engines),
    "- Standing instructions apply to the OpenAI path only. They do NOT rewrite verbatim memory hits.",
    "",
    `Document: ${context.filename} (${context.sourceLang} -> ${context.targetLang})`,
    `Segments: ${context.segments.length}, translated: ${translated}`,
    context.instructions
      ? `Standing instructions already in force: ${context.instructions}`
      : "No standing instructions yet.",
    "",
    "Segments:",
    ...segmentLines(context),
  );

  if (history.length) {
    lines.push("", "Conversation so far:");
    for (const item of history.slice(-MAX_HISTORY)) {
      lines.push(`${item.role === "user" ? "User" : "Lingua"}: ${item.content}`);
    }
  }

  lines.push(
    "",
    `User's new message: ${message}`,
    "",
    "Reply with a single JSON object and nothing else:",
    '{"reply": "...", "instructions": "..." or null, "retranslate": true or false}',
    "",
    "- reply: your answer in Turkish.",
    "- instructions: the FULL standing instruction set after this message, merging what was already in force with anything new the user just asked for. Null if the user only asked a question and changed nothing.",
    "- retranslate: true only when the user asked for a change that should be applied to already-translated segments.",
    "If you set retranslate to true, say in the reply that verbatim memory matches stay as they are.",
  );

  return lines.join("\n");
}

/**
 * Modelin JSON'unu okur. Model bazen JSON'u ``` içine sarar veya önüne bir
 * cümle koyar; o yüzden ilk `{` ile son `}` arası alınır. Hiç ayrıştırılamazsa
 * metnin kendisi cevap sayılır — kullanıcı boş ekran görmez, ama hiçbir
 * talimat da sessizce uygulanmış olmaz.
 */
export function parseChatDecision(raw: string): ChatDecision {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
      if (reply) {
        const instructions =
          typeof parsed.instructions === "string" && parsed.instructions.trim()
            ? parsed.instructions.trim()
            : null;
        return { reply, instructions, retranslate: parsed.retranslate === true };
      }
    } catch {
      // JSON değilmiş; aşağıdaki düz metin yoluna düşer.
    }
  }
  return { reply: raw.trim(), instructions: null, retranslate: false };
}

export async function runChat(
  context: DocumentContext,
  history: ChatMessage[],
  message: string,
  model: string,
): Promise<ChatDecision> {
  const raw = await askOpenAI(buildChatPrompt(context, history, message), model);
  return parseChatDecision(raw);
}
