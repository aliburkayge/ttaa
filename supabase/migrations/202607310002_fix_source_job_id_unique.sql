-- The partial unique index from 202607310001 cannot serve as an ON CONFLICT
-- arbiter for a plain `upsert(..., { onConflict: "source_job_id" })` call
-- (Postgres requires the conflict target to match a full unique
-- constraint/index, or the INSERT predicate to match the partial index's
-- WHERE clause). Standard unique constraints already allow multiple NULLs,
-- so a full constraint gives the same "one row per job" guarantee without
-- the partial-index restriction.

drop index if exists public.content_projects_source_job_id_idx;

alter table public.content_projects
  drop constraint if exists content_projects_source_job_id_key;

alter table public.content_projects
  add constraint content_projects_source_job_id_key unique (source_job_id);
