import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { retryContentJob } from "../../../../../lib/jobs";
import { classifyJobError, publicJobError } from "../../../../../lib/job-errors";
import { newRequestId } from "../../../../../lib/observability";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId(request);
  try {
    const session = await requireAdminSession();
    const { id } = await context.params;
    const job = await retryContentJob(id, session.email);
    if (!job) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Job not found.", retryable: false, requestId } }, { status: 404 });
    if (job.status !== "queued") {
      return NextResponse.json({
        error: { code: "CONFLICT", message: job.error?.message || "This job cannot be retried.", retryable: false, requestId },
        jobId: job.id,
        status: job.status,
      }, { status: 409 });
    }
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Your session expired.", retryable: false, requestId } }, { status: 401 });
    }
    const safe = classifyJobError(error, "retry", requestId);
    return NextResponse.json({ error: publicJobError(safe) }, { status: safe.httpStatus });
  }
}

