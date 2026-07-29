import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../lib/auth";
import { asyncJobsEnabled, createContentJob, getLatestActiveJob, type JobBrand } from "../../../lib/jobs";
import { classifyJobError, publicJobError } from "../../../lib/job-errors";
import { logEvent, newRequestId } from "../../../lib/observability";

export const runtime = "nodejs";
export const maxDuration = 30;

function validBrand(value: unknown): value is JobBrand {
  return value === "ttaa" || value === "ay-tercume";
}

function validateBrief(brief: unknown) {
  if (!brief || typeof brief !== "object") throw new Error("A content brief is required.");
  const topic = (brief as { topic?: unknown }).topic;
  if (typeof topic !== "string" || !topic.trim()) throw new Error("Topic is required.");
  if (topic.length > 240) throw new Error("Topic is too long.");
  return brief as Record<string, unknown>;
}

export async function POST(request: Request) {
  const requestId = newRequestId(request);
  try {
    if (!asyncJobsEnabled()) {
      return NextResponse.json({
        error: { code: "ASYNC_JOBS_DISABLED", message: "Durable jobs are not enabled yet.", retryable: false, requestId },
      }, { status: 503 });
    }
    const session = await requireAdminSession();
    const body = await request.json() as { brand?: unknown; brief?: unknown; clientRequestId?: unknown };
    if (!validBrand(body.brand)) throw new Error("Brand must be ttaa or ay-tercume.");
    const brief = validateBrief(body.brief);
    const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId.trim() : "";
    if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(clientRequestId)) throw new Error("A valid clientRequestId is required.");
    const idempotencyKey = `${session.email}:${body.brand}:${clientRequestId}`;
    const job = await createContentJob({ brand: body.brand, ownerEmail: session.email, idempotencyKey, brief });
    logEvent("job.queued", { requestId, jobId: job.id, brand: job.brand, stage: job.stage });
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: job.status === "queued" ? 202 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Your session expired.", retryable: false, requestId } }, { status: 401 });
    }
    const safe = classifyJobError(error, "queue", requestId);
    logEvent("job.queue_failed", { requestId, stage: safe.stage, errorCode: safe.code, httpStatus: safe.httpStatus });
    return NextResponse.json({ error: publicJobError(safe) }, { status: safe.httpStatus });
  }
}

export async function GET(request: Request) {
  const requestId = newRequestId(request);
  try {
    const session = await requireAdminSession();
    const brandValue = new URL(request.url).searchParams.get("brand");
    if (!validBrand(brandValue)) throw new Error("Brand must be ttaa or ay-tercume.");
    const job = await getLatestActiveJob(session.email, brandValue);
    return NextResponse.json({ jobId: job?.id || null, status: job?.status || null });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Your session expired.", retryable: false, requestId } }, { status: 401 });
    }
    const safe = classifyJobError(error, "queue", requestId);
    return NextResponse.json({ error: publicJobError(safe) }, { status: safe.httpStatus });
  }
}

