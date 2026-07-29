"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobBrand, JobStatus } from "./jobs";

export type PublicJobError = {
  code: string;
  message: string;
  stage?: string;
  retryable?: boolean;
  requestId?: string;
};

export type PublicJob<TResult> = {
  jobId: string;
  brand: JobBrand;
  status: JobStatus;
  stage: string;
  progress: number;
  elapsedMs: number;
  updatedAt: string;
  result?: TResult;
  error?: PublicJobError;
  canCancel?: boolean;
  canRetry?: boolean;
};

export class JobApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(message: string, code: string, status: number, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function json<T>(response: Response) {
  const body = await response.json() as T & { error?: PublicJobError };
  if (!response.ok) {
    const error = body.error;
    throw new JobApiError(error?.message || `Request failed (${response.status}).`, error?.code || "REQUEST_FAILED", response.status, Boolean(error?.retryable));
  }
  return body;
}

export function useContentJob<TResult>(brand: JobBrand) {
  const storageKey = `${brand}:active-content-job`;
  const [job, setJob] = useState<PublicJob<TResult> | null>(null);
  const [loading, setLoading] = useState(true);
  const stopped = useRef(false);
  const startInFlight = useRef<Promise<PublicJob<TResult>> | null>(null);

  const load = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const value = await json<PublicJob<TResult>>(response);
    setJob(value);
    if (value.status === "succeeded") {
      window.localStorage.removeItem(storageKey);
    }
    return value;
  }, [storageKey]);

  useEffect(() => {
    stopped.current = false;
    let timer = 0;
    let interval = 2_000;

    const schedule = (jobId: string) => {
      timer = window.setTimeout(async () => {
        if (stopped.current) return;
        try {
          const value = await load(jobId);
          if (value.status === "queued" || value.status === "running") {
            interval = Math.min(5_000, interval + 500);
            schedule(jobId);
          }
        } catch {
          interval = Math.min(5_000, interval + 500);
          schedule(jobId);
        }
      }, interval);
    };

    const resume = async () => {
      try {
        let jobId = window.localStorage.getItem(storageKey);
        if (!jobId) {
          const response = await fetch(`/api/jobs?brand=${encodeURIComponent(brand)}`, { cache: "no-store" });
          if (response.ok) jobId = (await response.json() as { jobId?: string | null }).jobId || null;
        }
        if (jobId) {
          window.localStorage.setItem(storageKey, jobId);
          const value = await load(jobId);
          if (value.status === "queued" || value.status === "running") schedule(jobId);
        }
      } finally {
        setLoading(false);
      }
    };
    void resume();
    return () => {
      stopped.current = true;
      window.clearTimeout(timer);
    };
  }, [brand, load, storageKey]);

  const start = useCallback((brief: Record<string, unknown>) => {
    if (startInFlight.current) return startInFlight.current;
    const task = (async () => {
      const clientRequestId = crypto.randomUUID();
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, brief, clientRequestId }),
      });
      const value = await json<{ jobId: string; status: JobStatus }>(response);
      window.localStorage.setItem(storageKey, value.jobId);
      const initial: PublicJob<TResult> = {
        jobId: value.jobId,
        brand,
        status: value.status,
        stage: "queued",
        progress: 0,
        elapsedMs: 0,
        updatedAt: new Date().toISOString(),
      };
      setJob(initial);
      window.location.reload();
      return initial;
    })();
    startInFlight.current = task;
    void task.catch(() => {
      startInFlight.current = null;
    });
    return task;
  }, [brand, storageKey]);

  const retry = useCallback(async () => {
    if (!job) return;
    const response = await fetch(`/api/jobs/${encodeURIComponent(job.jobId)}/retry`, { method: "POST" });
    await json(response);
    window.localStorage.setItem(storageKey, job.jobId);
    window.location.reload();
  }, [job, storageKey]);

  const cancel = useCallback(async () => {
    if (!job) return;
    const response = await fetch(`/api/jobs/${encodeURIComponent(job.jobId)}/cancel`, { method: "POST" });
    await json(response);
    setJob((current) => current ? { ...current, stage: "cancelling" } : current);
  }, [job]);

  return {
    job,
    loading,
    start,
    retry,
    cancel,
    active: job?.status === "queued" || job?.status === "running",
  };
}
