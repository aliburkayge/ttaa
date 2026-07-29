import { NextResponse } from "next/server";
import { asyncJobsEnabled, getWorkerAvailability } from "../../../lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET() {
  const checkedAt = new Date().toISOString();
  if (!asyncJobsEnabled()) {
    return NextResponse.json({ web: "ok", asyncJobs: false, worker: { status: "disabled" }, checkedAt });
  }
  try {
    const { heartbeat, ageMs, healthy } = await getWorkerAvailability();
    return NextResponse.json({
      web: "ok",
      asyncJobs: true,
      worker: heartbeat ? { status: healthy ? heartbeat.status : "stale", lastSeenAt: heartbeat.last_seen_at, ageMs } : { status: "missing" },
      checkedAt,
    }, { status: healthy ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      web: "ok",
      asyncJobs: true,
      worker: { status: "unavailable" },
      error: error instanceof Error ? error.message : "Health check failed.",
      checkedAt,
    }, { status: 503 });
  }
}
