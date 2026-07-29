create extension if not exists pgcrypto;

create table if not exists public.content_jobs (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('ttaa', 'ay-tercume')),
  owner_email text not null,
  idempotency_key text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage text not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  brief jsonb not null,
  checkpoint jsonb not null default '{}'::jsonb,
  result jsonb,
  error jsonb,
  stage_attempts jsonb not null default '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists content_jobs_queue_idx
  on public.content_jobs (status, lease_expires_at, created_at);
create index if not exists content_jobs_owner_idx
  on public.content_jobs (owner_email, created_at desc);

create table if not exists public.content_worker_heartbeats (
  worker_id text primary key,
  status text not null default 'idle',
  active_job_id uuid references public.content_jobs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.content_jobs enable row level security;
alter table public.content_worker_heartbeats enable row level security;

revoke all on public.content_jobs from anon, authenticated;
revoke all on public.content_worker_heartbeats from anon, authenticated;

create or replace function public.claim_content_job(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.content_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from public.content_jobs
  where
    (status = 'queued' and cancel_requested = false)
    or (status = 'running' and lease_expires_at < now())
  order by created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  return query
  update public.content_jobs
  set
    status = 'running',
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = v_job_id
  returning *;
end;
$$;

create or replace function public.renew_content_job_lease(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.content_jobs
  set
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    updated_at = now()
  where id = p_job_id
    and status = 'running'
    and lease_owner = p_worker_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.requeue_stale_content_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.content_jobs
  set
    status = 'queued',
    lease_owner = null,
    lease_expires_at = null,
    updated_at = now()
  where status = 'running'
    and lease_expires_at < now()
    and cancel_requested = false;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.claim_content_job(text, integer) from public;
revoke all on function public.renew_content_job_lease(uuid, text, integer) from public;
revoke all on function public.requeue_stale_content_jobs() from public;
grant execute on function public.claim_content_job(text, integer) to service_role;
grant execute on function public.renew_content_job_lease(uuid, text, integer) to service_role;
grant execute on function public.requeue_stale_content_jobs() to service_role;

comment on table public.content_jobs is
  'Durable, service-role-only content generation queue for TTAA and AY Tercume.';
comment on table public.content_worker_heartbeats is
  'Railway worker liveness and active-job heartbeat. No browser access.';
