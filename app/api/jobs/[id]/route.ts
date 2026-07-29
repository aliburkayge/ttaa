import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { failUnclaimedJobWithoutWorker, getContentJob, getWorkerAvailability } from "../../../../lib/jobs";
import { classifyJobError, publicJobError } from "../../../../lib/job-errors";
import { newRequestId } from "../../../../lib/observability";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId(request);
  try {
    const session = await requireAdminSession();
    const { id } = await context.params;
    let job = await getContentJob(id);
    if (!job || job.owner_email !== session.email) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Job not found.", retryable: false, requestId } }, { status: 404 });
    }
    const queuedForMs = job.status === "queued" ? Date.now() - Date.parse(job.created_at) : 0;
    if (job.status === "queued" && !job.lease_owner && queuedForMs > 120_000) {
      const worker = await getWorkerAvailability();
      if (!worker.healthy) job = await failUnclaimedJobWithoutWorker(job);
    }
    const started = job.started_at ? Date.parse(job.started_at) : Date.parse(job.created_at);
    return NextResponse.json({
      jobId: job.id,
      brand: job.brand,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      elapsedMs: Math.max(0, Date.now() - started),
      updatedAt: job.updated_at,
      result: job.status === "succeeded" ? job.result : undefined,
      error: job.status === "failed" || job.status === "cancelled" ? job.error : undefined,
      canCancel: job.status === "queued" || job.status === "running",
      canRetry: Boolean(job.error?.retryable) || job.status === "cancelled",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Your session expired.", retryable: false, requestId } }, { status: 401 });
    }
    const safe = classifyJobError(error, "status", requestId);
    return NextResponse.json({ error: publicJobError(safe) }, { status: safe.httpStatus });
  }
}
