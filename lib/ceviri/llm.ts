import { fetchWithRetry, integerEnv } from "../upstream";
import { askOpenAI } from "./translate";

/**
 * Belge düzeyindeki metin görevleri (tutarlılık incelemesi) için dil modeli.
 * OpenAI yanıt vermezse (anahtar yok, kredi bitti) Mistral'in büyük modeli.
 */
export async function askModel(prompt: string): Promise<string> {
  try {
    return await askOpenAI(prompt, process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23");
  } catch (openaiError) {
    const key = process.env.MISTRAL_API_KEY?.trim();
    if (!key) throw openaiError;
    const response = await fetchWithRetry(
      "https://api.mistral.ai/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.MISTRAL_TEXT_MODEL?.trim() || "mistral-large-latest",
          response_format: { type: "json_object" },
          // İnceleme her çalıştırmada aynı sonucu vermeli.
          temperature: 0,
          messages: [{ role: "user", content: prompt }],
        }),
        cache: "no-store",
      },
      {
        upstream: "Mistral (inceleme)",
        timeoutMs: integerEnv("MISTRAL_TIMEOUT_MS", 180_000),
        maxAttempts: 2,
        retryUnsafe: true,
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: string;
    };
    if (!response.ok) throw new Error(body.message ?? `Mistral HTTP ${response.status}`);
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Mistral boş yanıt döndü.");
    return text;
  }
}
