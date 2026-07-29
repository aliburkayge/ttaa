import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { requestJobCancellation } from "../../../../../lib/jobs";
import { classifyJobError, publicJobError } from "../../../../../lib/job-errors";
import { newRequestId } from "../../../../../lib/observability";
import { cancelOpenAIResponse } from "../../../../../lib/openai-background";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId(request);
  try {
    const session = await requireAdminSession();
    const { id } = await context.params;
    const job = await requestJobCancellation(id, session.email);
    if (!job) return NextResponse.json({ error: { code: "CONFLICT", message: "The job is already finished or was not found.", retryable: false, requestId } }, { status: 409 });
    const responseIds = Object.values((job.checkpoint?.responseIds || {}) as Record<string, unknown>)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (job.status === "running" && responseIds.length) {
      await Promise.allSettled(responseIds.map((responseId) => cancelOpenAIResponse(responseId)));
    }
    return NextResponse.json({ jobId: job.id, status: job.status, cancelRequested: true }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Your session expired.", retryable: false, requestId } }, { status: 401 });
    }
    const safe = classifyJobError(error, "cancel", requestId);
    return NextResponse.json({ error: publicJobError(safe) }, { status: safe.httpStatus });
  }
}
