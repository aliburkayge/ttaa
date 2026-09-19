import assert from "node:assert/strict";
import test from "node:test";
import { ceviriCredentials } from "../lib/ceviri/supabase.ts";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = { ...process.env };
  Object.assign(process.env, values);
  try { run(); } finally { process.env = previous; }
}

test("returns both credentials when configured", () => {
  withEnv({ CEVIRI_SUPABASE_URL: "https://x.supabase.co", CEVIRI_SUPABASE_SERVICE_ROLE_KEY: "key" }, () => {
    assert.deepEqual(ceviriCredentials(), { url: "https://x.supabase.co", serviceRoleKey: "key" });
  });
});

test("names the missing variable so the operator can fix it", () => {
  withEnv({ CEVIRI_SUPABASE_URL: undefined, CEVIRI_SUPABASE_SERVICE_ROLE_KEY: "key" }, () => {
    assert.throws(() => ceviriCredentials(), /CEVIRI_SUPABASE_URL/);
  });
  withEnv({ CEVIRI_SUPABASE_URL: "https://x.supabase.co", CEVIRI_SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
    assert.throws(() => ceviriCredentials(), /CEVIRI_SUPABASE_SERVICE_ROLE_KEY/);
  });
});

test("refuses the blog project's credentials", () => {
  withEnv({ CEVIRI_SUPABASE_URL: "", CEVIRI_SUPABASE_SERVICE_ROLE_KEY: "" }, () => {
    assert.throws(() => ceviriCredentials(), /CEVIRI_SUPABASE_URL/);
  });
});
