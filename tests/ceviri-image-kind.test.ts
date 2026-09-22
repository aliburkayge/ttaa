import assert from "node:assert/strict";
import test from "node:test";
import { classifyImage } from "../lib/ceviri/image-kind.ts";

const IMAGE = "data:image/jpeg;base64,AAAA";

function withFetch(handler: (url: string) => Response, run: () => Promise<void>) {
  return async () => {
    const original = globalThis.fetch;
    const saved = { openai: process.env.OPENAI_API_KEY, mistral: process.env.MISTRAL_API_KEY };
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MISTRAL_API_KEY = "mistral-test";
    globalThis.fetch = (async (input: string | URL | Request) => handler(String(input))) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
      process.env.OPENAI_API_KEY = saved.openai;
      process.env.MISTRAL_API_KEY = saved.mistral;
    }
  };
}

const openaiReply = (kind: string) => Response.json({ output_text: `{"kind": "${kind}"}` });
const mistralReply = (kind: string) => Response.json({ choices: [{ message: { content: `{"kind": "${kind}"}` } }] });

test(
  "asks OpenAI first and does not bother Mistral when it answers",
  withFetch(
    (url) => (url.includes("openai") ? openaiReply("stamp") : mistralReply("logo")),
    async () => assert.equal(await classifyImage(IMAGE, "model"), "stamp"),
  ),
);

test(
  "falls back to Mistral's vision model when OpenAI refuses (e.g. no credits)",
  withFetch(
    (url) => (url.includes("openai") ? Response.json({ error: { message: "no credits" } }, { status: 401 }) : mistralReply("signature")),
    async () => assert.equal(await classifyImage(IMAGE, "model"), "signature"),
  ),
);

test(
  "says unknown when neither model answers, so nothing is erased",
  withFetch(
    () => Response.json({ error: { message: "down" } }, { status: 401 }),
    async () => assert.equal(await classifyImage(IMAGE, "model"), "unknown"),
  ),
);
