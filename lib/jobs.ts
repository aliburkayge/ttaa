import { getSupabaseAdmin } from "./supabase";
import type { SafeJobError } from "./job-errors";

export type JobBrand = "ttaa" | "ay-tercume";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ContentJob = {
  id: string;
  brand: JobBrand;
  owner_email: string;
  idempotency_key: string;
  status: JobStatus;
  stage: string;
  progress: number;
  brief: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: SafeJobError | null;
  stage_attempts: Record<string, number>;
  lease_owner: string | null;
  lease_expires_at: string | null;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
};

const TABLE = "content_jobs";

export function asyncJobsEnabled() {
  return process.env.ASYNC_JOBS_ENABLED === "true";
}

export async function createContentJob(input: {
  brand: JobBrand;
  ownerEmail: string;
  idempotencyKey: string;
  brief: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({
      brand: input.brand,
      owner_email: input.ownerEmail,
      idempotency_key: input.idempotencyKey,
      brief: input.brief,
      status: "queued",
      stage: "queued",
      progress: 0,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Supabase job creation failed: ${error.message}`);
  if (data) return data as ContentJob;

  const existing = await getContentJobByIdempotency(input.idempotencyKey);
  if (!existing) throw new Error("The idempotent job could not be loaded after creation.");
  return existing;
}

export async function getContentJob(id: string) {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Supabase job lookup failed: ${error.message}`);
  return data as ContentJob | null;
}

export async function getContentJobByIdempotency(idempotencyKey: string) {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (error) throw new Error(`Supabase idempotency lookup failed: ${error.message}`);
  return data as ContentJob | null;
}

export async function getLatestActiveJob(ownerEmail: string, brand: JobBrand) {
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select("*")
    .eq("owner_email", ownerEmail)
    .eq("brand", brand)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase active job lookup failed: ${error.message}`);
  return data as ContentJob | null;
}

export async function claimContentJob(workerId: string, leaseSeconds: number) {
  const { data, error } = await getSupabaseAdmin().rpc("claim_content_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`Supabase job claim failed: ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) as ContentJob | undefined;
}

export async function renewContentJobLease(id: string, workerId: string, leaseSeconds: number) {
  const { data, error } = await getSupabaseAdmin().rpc("renew_content_job_lease", {
    p_job_id: id,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`Supabase lease renewal failed: ${error.message}`);
  return Boolean(data);
}

export async function updateJobCheckpoint(
  job: ContentJob,
  workerId: string,
  input: {
    stage: string;
    progress: number;
    checkpoint?: Record<string, unknown>;
    result?: Record<string, unknown> | null;
  },
) {
  const payload = {
    stage: input.stage,
    progress: input.progress,
    checkpoint: input.checkpoint ?? job.checkpoint,
    ...(job.stage !== input.stage ? {
      stage_attempts: {
        ...(job.stage_attempts || {}),
        [input.stage]: Number(job.stage_attempts?.[input.stage] || 0) + 1,
      },
    } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update(payload)
    .eq("id", job.id)
    .eq("status", "running")
    .eq("lease_owner", workerId)
    .select("*")
    .single();
  if (error) throw new Error(`Supabase checkpoint failed: ${error.message}`);
  return data as ContentJob;
}

export async function completeContentJob(job: ContentJob, workerId: string, result: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      status: "succeeded",
      stage: "completed",
      progress: 100,
      result,
      error: null,
      finished_at: now,
      updated_at: now,
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq("id", job.id)
    .eq("lease_owner", workerId)
    .select("*")
    .single();
  if (error) throw new Error(`Supabase job completion failed: ${error.message}`);
  return data as ContentJob;
}

export async function failContentJob(job: ContentJob, workerId: string, errorValue: SafeJobError) {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      status: errorValue.code === "CANCELLED" ? "cancelled" : "failed",
      error: errorValue,
      finished_at: now,
      updated_at: now,
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq("id", job.id)
    .eq("lease_owner", workerId);
  if (error) throw new Error(`Supabase job failure checkpoint failed: ${error.message}`);
}

export async function requestJobCancellation(id: string, ownerEmail: string) {
  const current = await getContentJob(id);
  if (!current || current.owner_email !== ownerEmail || !["queued", "running"].includes(current.status)) return null;
  const now = new Date().toISOString();
  const immediate = current.status === "queued";
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      cancel_requested: true,
      ...(immediate ? {
        status: "cancelled",
        stage: "cancelled",
        finished_at: now,
        error: { code: "CANCELLED", message: "The job was cancelled safely.", stage: current.stage, retryable: false, httpStatus: 409 },
      } : {}),
      updated_at: now,
    })
    .eq("id", id)
    .eq("owner_email", ownerEmail)
    .in("status", ["queued", "running"])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Supabase cancellation request failed: ${error.message}`);
  return data as ContentJob | null;
}

export async function requeueContentJob(job: ContentJob, workerId: string, errorValue: SafeJobError) {
  const attempt = Number(job.stage_attempts?.[job.stage] || 0) + 1;
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      status: "queued",
      error: errorValue,
      stage_attempts: { ...(job.stage_attempts || {}), [job.stage]: attempt },
      lease_owner: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("lease_owner", workerId)
    .select("*")
    .single();
  if (error) throw new Error(`Supabase automatic retry failed: ${error.message}`);
  return data as ContentJob;
}

export async function retryContentJob(id: string, ownerEmail: string) {
  const current = await getContentJob(id);
  if (!current || current.owner_email !== ownerEmail) return null;
  if (!["failed", "cancelled"].includes(current.status)) return current;
  if (current.error && !current.error.retryable && current.error.code !== "CANCELLED") return current;
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      status: "queued",
      error: null,
      cancel_requested: false,
      lease_owner: null,
      lease_expires_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_email", ownerEmail)
    .select("*")
    .single();
  if (error) throw new Error(`Supabase job retry failed: ${error.message}`);
  return data as ContentJob;
}

export async function writeWorkerHeartbeat(workerId: string, status: string, activeJobId?: string) {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin().from("content_worker_heartbeats").upsert({
    worker_id: workerId,
    status,
    active_job_id: activeJobId || null,
    last_seen_at: now,
    metadata: { railwayService: process.env.RAILWAY_SERVICE_NAME || null },
  });
  if (error) throw new Error(`Supabase worker heartbeat failed: ${error.message}`);
}

export async function getLatestWorkerHeartbeat() {
  const { data, error } = await getSupabaseAdmin()
    .from("content_worker_heartbeats")
    .select("worker_id,status,active_job_id,last_seen_at,started_at")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase worker heartbeat lookup failed: ${error.message}`);
  return data;
}

export async function getWorkerAvailability(maxAgeMs = 90_000) {
  const heartbeat = await getLatestWorkerHeartbeat();
  const ageMs = heartbeat?.last_seen_at ? Date.now() - Date.parse(heartbeat.last_seen_at) : null;
  return {
    healthy: ageMs !== null && ageMs >= 0 && ageMs < maxAgeMs,
    heartbeat,
    ageMs,
  };
}

export async function failUnclaimedJobWithoutWorker(job: ContentJob) {
  if (job.status !== "queued" || job.lease_owner) return job;
  const now = new Date().toISOString();
  const errorValue: SafeJobError = {
    code: "WORKER_UNAVAILABLE",
    message: "The Railway content worker is not connected. Check the worker start command and Supabase service-role variables, then retry this job.",
    stage: "queued",
    retryable: true,
    httpStatus: 503,
  };
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      status: "failed",
      error: errorValue,
      finished_at: now,
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .is("lease_owner", null)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Supabase unavailable-worker checkpoint failed: ${error.message}`);
  return (data || job) as ContentJob;
}

export async function recoverWorkerUnavailableJobs(limit = 10) {
  const { data: failed, error: lookupError } = await getSupabaseAdmin()
    .from(TABLE)
    .select("id")
    .eq("status", "failed")
    .contains("error", { code: "WORKER_UNAVAILABLE" })
    .order("updated_at", { ascending: true })
    .limit(Math.max(1, Math.min(50, limit)));
  if (lookupError) throw new Error(`Supabase worker-recovery lookup failed: ${lookupError.message}`);
  const ids = (failed || []).map((job) => job.id);
  if (!ids.length) return 0;
  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      status: "queued",
      error: null,
      finished_at: null,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("status", "failed");
  if (error) throw new Error(`Supabase worker recovery failed: ${error.message}`);
  return ids.length;
}

export async function deleteExpiredJobs(retentionDays: number) {
  const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000).toISOString();
  const { error, count } = await getSupabaseAdmin()
    .from(TABLE)
    .delete({ count: "exact" })
    .in("status", ["succeeded", "failed", "cancelled"])
    .lt("finished_at", cutoff);
  if (error) throw new Error(`Supabase job retention cleanup failed: ${error.message}`);
  return count || 0;
}
