import { parseResilientJson } from "./json";
import { integerEnv } from "./upstream";

type OpenAIResponseState = {
  id?: string;
  status?: string;
  error?: { message?: string; code?: string } | null;
  incomplete_details?: { reason?: string } | null;
};

export type OpenAIResponseOptions = {
  stage: string;
  idempotencyKey?: string;
  resumeResponseId?: string;
  onResponseId?: (stage: string, responseId: string) => Promise<void> | void;
};

function apiKey() {
  const value = process.env.OPENAI_API_KEY?.trim();
  if (!value) throw new Error("OPENAI_API_KEY is missing from the server environment.");
  return value;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readResponse(response: Response, label: string) {
  const raw = await response.text();
  let body: OpenAIResponseState;
  try {
    body = parseResilientJson<OpenAIResponseState>(raw, label);
  } catch (error) {
    if (!response.ok && /upstream error/i.test(raw)) throw new Error(`OpenAI generation failed: temporary upstream service error (HTTP ${response.status}).`);
    throw error;
  }
  if (!response.ok) throw new Error(`OpenAI generation failed: ${body.error?.message || `HTTP ${response.status}`}`);
  return body;
}

async function retrieveResponse(responseId: string) {
  const timeoutMs = integerEnv("OPENAI_RESPONSE_TIMEOUT_MS", 480_000);
  const deadline = Date.now() + timeoutMs;
  let transientFailures = 0;
  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
        headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      transientFailures += 1;
      if (transientFailures > 2) throw error;
      await wait(1_000 * transientFailures);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      transientFailures += 1;
      if (transientFailures > 2) throw new Error(`OpenAI response polling failed (HTTP ${response.status}).`);
      await wait(Math.min(8_000, 1_000 * 2 ** transientFailures + Math.floor(Math.random() * 400)));
      continue;
    }
    const body = await readResponse(response, "OpenAI background response");
    if (body.status === "completed") return body;
    if (["failed", "cancelled", "incomplete"].includes(body.status || "")) {
      throw new Error(`OpenAI generation failed: ${body.error?.message || body.incomplete_details?.reason || body.status}`);
    }
    transientFailures = 0;
    await wait(2_000);
  }
  throw new Error(`OpenAI response ${responseId} timed out after ${timeoutMs}ms.`);
}

export async function requestOpenAIResponse(payload: Record<string, unknown>, options: OpenAIResponseOptions) {
  if (options.resumeResponseId) return retrieveResponse(options.resumeResponseId);
  const background = process.env.OPENAI_BACKGROUND_MODE !== "false";
  const timeoutMs = background ? 60_000 : integerEnv("OPENAI_RESPONSE_TIMEOUT_MS", 480_000);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify({ ...payload, ...(background ? { background: true } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readResponse(response, `OpenAI ${options.stage} response`);
  if (body.id) await options.onResponseId?.(options.stage, body.id);
  if (body.status === "completed" || !background) return body;
  if (["failed", "cancelled", "incomplete"].includes(body.status || "")) {
    throw new Error(`OpenAI generation failed: ${body.error?.message || body.incomplete_details?.reason || body.status}`);
  }
  if (!body.id) throw new Error("OpenAI background response did not include a response ID.");
  return retrieveResponse(body.id);
}

export async function cancelOpenAIResponse(responseId: string) {
  const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 409 && response.status !== 404) {
    throw new Error(`OpenAI response cancellation failed (HTTP ${response.status}).`);
  }
}

