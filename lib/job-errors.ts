export type SafeErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "QUALITY_GATE_FAILED"
  | "RATE_LIMITED"
  | "BILLING_OR_QUOTA"
  | "MODERATION_BLOCKED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  | "CANCELLED"
  | "INTERNAL_ERROR";

export type SafeJobError = {
  code: SafeErrorCode;
  message: string;
  stage: string;
  retryable: boolean;
  httpStatus: number;
  upstream?: string;
  upstreamStatus?: number;
  requestId?: string;
};

function textOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function classifyJobError(error: unknown, stage = "unknown", requestId?: string): SafeJobError {
  const message = textOf(error);
  const lower = message.toLowerCase();
  const upstreamStatus = Number(/\b(?:http|status)\s*(\d{3})\b/i.exec(message)?.[1]) || undefined;

  let safe: Omit<SafeJobError, "stage" | "requestId">;
  if (/cancel(?:led|ed)|iptal/.test(lower)) {
    safe = { code: "CANCELLED", message: "The job was cancelled safely.", retryable: false, httpStatus: 409 };
  } else if (/billing|quota|hard limit|insufficient_quota|credit balance/.test(lower)) {
    safe = { code: "BILLING_OR_QUOTA", message, retryable: false, httpStatus: 422, upstream: "openai", upstreamStatus };
  } else if (/moderation|safety system|content policy|refusal|reddetti/.test(lower)) {
    safe = { code: "MODERATION_BLOCKED", message, retryable: false, httpStatus: 422, upstream: "openai", upstreamStatus };
  } else if (/quality|topic audit|repetition|keyword|faq|kalite kap/.test(lower)) {
    safe = { code: "QUALITY_GATE_FAILED", message, retryable: false, httpStatus: 422, upstreamStatus };
  } else if (upstreamStatus === 429 || /rate limit|too many requests/.test(lower)) {
    safe = { code: "RATE_LIMITED", message, retryable: true, httpStatus: 429, upstreamStatus };
  } else if (/timed? ?out|timeout|deadline|exceeded the safe/.test(lower)) {
    safe = { code: "UPSTREAM_TIMEOUT", message, retryable: true, httpStatus: 504, upstreamStatus };
  } else if ((upstreamStatus && upstreamStatus >= 500) || /upstream|fetch failed|econn|socket|network/.test(lower)) {
    safe = { code: "UPSTREAM_UNAVAILABLE", message, retryable: true, httpStatus: 503, upstreamStatus };
  } else if (/missing|not configured|credentials/.test(lower)) {
    safe = { code: "CONFIGURATION_ERROR", message, retryable: false, httpStatus: 500, upstreamStatus };
  } else if (/required|too long|must contain|invalid|geçersiz|gereklidir/.test(lower)) {
    safe = { code: "VALIDATION_ERROR", message, retryable: false, httpStatus: 400, upstreamStatus };
  } else {
    safe = { code: "INTERNAL_ERROR", message, retryable: false, httpStatus: 500, upstreamStatus };
  }
  return { ...safe, stage, ...(requestId ? { requestId } : {}) };
}

export function publicJobError(error: SafeJobError) {
  return {
    code: error.code,
    message: error.message,
    stage: error.stage,
    retryable: error.retryable,
    requestId: error.requestId,
  };
}

