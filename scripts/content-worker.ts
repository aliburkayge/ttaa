import { loadEnvConfig } from "@next/env";
import { createServer, type Server } from "node:http";

loadEnvConfig(process.cwd());
process.env.CONTENT_WORKER = "true";

const { classifyJobError } = await import("../lib/job-errors");
const {
  claimContentJob,
  completeContentJob,
  deleteExpiredJobs,
  failContentJob,
  getContentJob,
  recoverWorkerUnavailableJobs,
  requeueContentJob,
  renewContentJobLease,
  writeWorkerHeartbeat,
} = await import("../lib/jobs");
const { runContentJob } = await import("../lib/job-pipeline");
const { logEvent } = await import("../lib/observability");
const workerId = process.env.RAILWAY_REPLICA_ID
  || process.env.RAILWAY_DEPLOYMENT_ID
  || `local-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const leaseSeconds = Math.max(30, Math.round(Number(process.env.JOB_LEASE_SECONDS) || 120));
const heartbeatMs = Math.max(10_000, Math.round((Number(process.env.JOB_HEARTBEAT_SECONDS) || 30) * 1_000));
let stopping = false;
let activeJobId: string | undefined;
let healthServer: Server | null = null;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    logEvent("worker.stopping", { workerId, signal, jobId: activeJobId });
  });
}

async function heartbeat(status: string) {
  try {
    await writeWorkerHeartbeat(workerId, status, activeJobId);
  } catch (error) {
    logEvent("worker.heartbeat_failed", { workerId, jobId: activeJobId, errorCode: classifyJobError(error, "heartbeat").code });
  }
}

function startHealthServer() {
  const port = Number(process.env.PORT);
  if (!Number.isFinite(port) || port <= 0) return;
  healthServer = createServer((request, response) => {
    if (request.url === "/api/auth/status" || request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({
        worker: "ok",
        status: activeJobId ? "busy" : stopping ? "stopping" : "idle",
        activeJob: Boolean(activeJobId),
      }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });
  healthServer.listen(port, "0.0.0.0", () => {
    logEvent("worker.health_server_started", { workerId, port });
  });
}

async function run() {
  logEvent("worker.started", { workerId, leaseSeconds, heartbeatMs, concurrency: 1 });
  try {
    await writeWorkerHeartbeat(workerId, "starting");
  } catch (error) {
    logEvent("worker.startup_failed", { workerId, stage: "heartbeat", errorCode: classifyJobError(error, "heartbeat").code });
    throw error;
  }
  startHealthServer();
  try {
    const recovered = await recoverWorkerUnavailableJobs();
    logEvent("worker.unavailable_jobs_recovered", { workerId, recovered });
  } catch (error) {
    logEvent("worker.recovery_failed", { workerId, errorCode: classifyJobError(error, "worker-recovery").code });
  }
  try {
    const deleted = await deleteExpiredJobs(Math.max(1, Number(process.env.JOB_RETENTION_DAYS) || 7));
    logEvent("worker.retention_cleanup", { workerId, deleted });
  } catch (error) {
    logEvent("worker.retention_failed", { workerId, errorCode: classifyJobError(error, "retention").code });
  }
  const idleHeartbeat = setInterval(() => void heartbeat(activeJobId ? "busy" : "idle"), heartbeatMs);
  idleHeartbeat.unref();

  while (!stopping) {
    let job;
    try {
      job = await claimContentJob(workerId, leaseSeconds);
    } catch (error) {
      const safe = classifyJobError(error, "claim");
      logEvent("worker.claim_failed", { workerId, errorCode: safe.code, retryable: safe.retryable });
      await wait(5_000);
      continue;
    }
    if (!job) {
      await wait(2_000);
      continue;
    }

    activeJobId = job.id;
    await heartbeat("busy");
    logEvent("job.started", { workerId, jobId: job.id, brand: job.brand, stage: job.stage });
    const leaseTimer = setInterval(() => {
      void renewContentJobLease(job.id, workerId, leaseSeconds).then((renewed) => {
        if (!renewed) logEvent("job.lease_lost", { workerId, jobId: job.id, brand: job.brand });
      }).catch((error) => {
        logEvent("job.lease_failed", { workerId, jobId: job.id, errorCode: classifyJobError(error, "lease").code });
      });
    }, heartbeatMs);
    leaseTimer.unref();

    try {
      const result = await runContentJob(job, workerId);
      await completeContentJob(job, workerId, result);
      logEvent("job.completed", { workerId, jobId: job.id, brand: job.brand, stage: "completed" });
    } catch (error) {
      const latest = await getContentJob(job.id).catch(() => null);
      const active = latest || job;
      const safe = active.cancel_requested
        ? classifyJobError(new Error("The content job was cancelled."), active.stage || "worker", job.id)
        : classifyJobError(error, active.stage || "worker", job.id);
      const stageAttempts = Number(active.stage_attempts?.[active.stage] || 0);
      try {
        if (safe.retryable && stageAttempts < 2 && !active.cancel_requested) {
          await requeueContentJob(active, workerId, safe);
          logEvent("job.retry_scheduled", { workerId, jobId: job.id, brand: job.brand, stage: safe.stage, attempt: stageAttempts + 1, errorCode: safe.code });
        } else {
          await failContentJob(active, workerId, safe);
        }
      } catch (checkpointError) {
        logEvent("job.failure_checkpoint_failed", { workerId, jobId: job.id, errorCode: classifyJobError(checkpointError, "failure-checkpoint").code });
      }
      logEvent(safe.retryable && stageAttempts < 2 && !active.cancel_requested ? "job.retrying" : "job.failed", {
        workerId,
        jobId: job.id,
        brand: job.brand,
        stage: safe.stage,
        errorCode: safe.code,
        retryable: safe.retryable,
        upstreamStatus: safe.upstreamStatus,
      });
    } finally {
      clearInterval(leaseTimer);
      activeJobId = undefined;
      await heartbeat(stopping ? "stopping" : "idle");
    }
  }

  clearInterval(idleHeartbeat);
  await heartbeat("stopped");
  if (healthServer) await new Promise<void>((resolve) => healthServer?.close(() => resolve()));
  logEvent("worker.stopped", { workerId });
}

await run();
