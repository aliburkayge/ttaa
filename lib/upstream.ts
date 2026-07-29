export type RetryOptions = {
  timeoutMs: number;
  maxAttempts?: number;
  upstream: string;
  retryUnsafe?: boolean;
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function transientStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function fetchWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  options: RetryOptions,
) {
  const method = (init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const attempts = Math.max(1, options.maxAttempts ?? 3);
  const canRetry = options.retryUnsafe || ["GET", "HEAD", "OPTIONS"].includes(method);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!canRetry || !transientStatus(response.status) || attempt === attempts) return response;
      const retryAfter = retryAfterMilliseconds(response);
      const backoff = retryAfter || Math.min(10_000, 650 * 2 ** (attempt - 1) + Math.floor(Math.random() * 350));
      await wait(backoff);
    } catch (error) {
      lastError = error;
      if (!canRetry || attempt === attempts) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new Error(`${options.upstream} request timed out after ${options.timeoutMs}ms.`);
        }
        throw error;
      }
      await wait(Math.min(10_000, 650 * 2 ** (attempt - 1) + Math.floor(Math.random() * 350)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${options.upstream} request failed.`);
}

export function integerEnv(name: string, fallback: number, minimum = 1_000) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.round(parsed) : fallback;
}

