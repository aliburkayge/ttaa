import { createClient } from "@supabase/supabase-js";
import { fetchWithRetry, integerEnv } from "../upstream";

export function ceviriCredentials(): { url: string; serviceRoleKey: string } {
  const url = process.env.CEVIRI_SUPABASE_URL;
  const serviceRoleKey = process.env.CEVIRI_SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("CEVIRI_SUPABASE_URL is not set.");
  if (!serviceRoleKey) throw new Error("CEVIRI_SUPABASE_SERVICE_ROLE_KEY is not set.");
  return { url, serviceRoleKey };
}

export function getCeviriSupabase() {
  const { url, serviceRoleKey } = ceviriCredentials();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { "X-Client-Info": "ttaa-ceviri-app" },
      fetch: (input, init) => fetchWithRetry(input, init, {
        upstream: "Supabase (çeviri)",
        timeoutMs: integerEnv("SUPABASE_REQUEST_TIMEOUT_MS", 30_000),
        maxAttempts: 3,
        retryUnsafe: true,
      }),
    },
  });
}

export const CEVIRI_DOCS_BUCKET = "ceviri-belgeler";
