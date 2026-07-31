alter table public.content_projects
  add column if not exists brand text,
  add column if not exists source_job_id uuid,
  add column if not exists revision integer not null default 1,
  add column if not exists last_synced_at timestamptz;

update public.content_projects
set brand = 'ttaa'
where brand is null;

alter table public.content_projects
  alter column brand set not null;

alter table public.content_projects
  drop constraint if exists content_projects_brand_check;

alter table public.content_projects
  add constraint content_projects_brand_check
  check (brand in ('ttaa', 'ay-tercume'));

alter table public.content_projects
  drop constraint if exists content_projects_source_job_id_fkey;

alter table public.content_projects
  add constraint content_projects_source_job_id_fkey
  foreign key (source_job_id) references public.content_jobs(id) on delete set null;

create unique index if not exists content_projects_source_job_id_idx
  on public.content_projects (source_job_id)
  where source_job_id is not null;

create index if not exists content_projects_owner_brand_idx
  on public.content_projects (created_by, brand, updated_at desc);

revoke all on public.content_projects from anon, authenticated;

comment on table public.content_projects is
  'Durable structured Content Studio projects for TTAA and AY Tercume. Service-role only.';
