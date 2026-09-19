import assert from "node:assert/strict";
import test from "node:test";
import { ceviriCredentials } from "../lib/ceviri/supabase.ts";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) previous.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
