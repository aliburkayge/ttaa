import { fetchWithRetry, integerEnv } from "../upstream";
import type { ImageKind } from "./ocr-layout";

/**
 * OCR'ın "görsel" diye ayırdığı bölgenin ne olduğunu söyler: imza, mühür,
 * logo, fotoğraf...
 *
 * Görev bilerek dar tutuldu: model yalnızca bir etiket seçer, metin yazmaz.
 * Görselin içindeki yazıyı okumak Mistral OCR'ın işi — bir dil modelinin
 * imzadan isim "okuması" tam da kaçınmamız gereken şey.
 */

const KINDS: readonly ImageKind[] = [
  "signature",
  "stamp",
  "signature_stamp",
  "logo",
  "photo",
  "barcode",
  "text",
];

const PROMPT = [
  "This image was cut out of a scanned official document.",
  "Classify it with exactly one label:",
  "- signature: a handwritten signature (possibly with printed name next to it)",
  "- stamp: an official stamp or seal, without a handwritten signature",
  "- signature_stamp: a handwritten signature and a stamp/seal together",
  "- logo: a company or institution logo",
  "- photo: a photograph, product picture, drawing or diagram",
  "- barcode: a barcode or QR code",
  "- text: only printed or typed text (no signature, stamp or logo)",
  'Reply with JSON only: {"kind": "<label>"}',
].join("\n");

export function parseImageKind(raw: string): ImageKind {
  const match = /"kind"\s*:\s*"([a-z_]+)"/.exec(raw);
  const value = match?.[1] as ImageKind | undefined;
  return value && KINDS.includes(value) ? value : "unknown";
}

type ResponsesBody = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

/**
 * `dataUrl` bir "data:image/jpeg;base64,..." adresidir. OpenAI yanıt vermezse
 * (anahtar yok, kredi bitti, hata) aynı soru Mistral'in görsel modeline
 * sorulur. İkisi de yanıt vermezse "unknown" döner: görsel olduğu gibi kalır
 * ve inceleyene bildirilir — imza sanılıp silinmez, logo sanılıp uydurulmaz.
 */
export async function classifyImage(dataUrl: string, model: string): Promise<ImageKind> {
  const kind = await classifyWithOpenAI(dataUrl, model);
  return kind === "unknown" ? classifyWithMistral(dataUrl) : kind;
}

async function classifyWithMistral(dataUrl: string): Promise<ImageKind> {
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) return "unknown";
  try {
    const response = await fetchWithRetry(
      "https://api.mistral.ai/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.MISTRAL_VISION_MODEL?.trim() || "mistral-medium-latest",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: PROMPT },
                { type: "image_url", image_url: dataUrl },
              ],
            },
          ],
        }),
        cache: "no-store",
      },
      {
        upstream: "Mistral (görsel türü)",
        timeoutMs: integerEnv("MISTRAL_TIMEOUT_MS", 60_000),
        maxAttempts: 3,
        retryUnsafe: true,
      },
    );
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseImageKind(body.choices?.[0]?.message?.content ?? "");
  } catch {
    return "unknown";
  }
}

async function classifyWithOpenAI(dataUrl: string, model: string): Promise<ImageKind> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return "unknown";

  try {
    const response = await fetchWithRetry(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: PROMPT },
                { type: "input_image", image_url: dataUrl },
              ],
            },
          ],
        }),
        cache: "no-store",
      },
      {
        upstream: "OpenAI (görsel türü)",
        timeoutMs: integerEnv("OPENAI_RESPONSE_TIMEOUT_MS", 120_000),
        maxAttempts: 3,
        retryUnsafe: true,
      },
    );
    const body = (await response.json()) as ResponsesBody;
    if (!response.ok) return "unknown";
    const text =
      body.output_text ??
      body.output?.flatMap((item) => item.content ?? []).find((c) => c.type === "output_text")?.text ??
      "";
    return parseImageKind(text);
  } catch {
    return "unknown";
  }
}
