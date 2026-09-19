create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- Kapsam --------------------------------------------------------------

create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.sectors(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  default_sector_id uuid references public.sectors(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- İçe aktarma kaydı ---------------------------------------------------

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tmx', 'termbase-xlsx', 'reference-archive')),
  filename text not null,
  file_hash text not null,
  stats jsonb not null default '{}'::jsonb,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Terminoloji ---------------------------------------------------------

create table if not exists public.term_concepts (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global', 'sector', 'client')),
  scope_id uuid,
  domain text,
  subdomain text,
  definition text,
  import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint term_concepts_scope_id_matches_type
    check ((scope_type = 'global') = (scope_id is null))
);

create table if not exists public.term_variants (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.term_concepts(id) on delete cascade,
  lang text not null,
  text text not null,
  normalized text not null,
  is_preferred boolean not null default true,
  is_forbidden boolean not null default false,
  notes text,
  example text,
  created_at timestamptz not null default now()
);

create index if not exists term_variants_concept_idx on public.term_variants (concept_id);
create index if not exists term_variants_lookup_idx on public.term_variants (lang, normalized);

-- Çeviri belleği ------------------------------------------------------

create table if not exists public.tm_segments (
  id uuid primary key default gen_random_uuid(),
  source_lang text not null,
  target_lang text not null,
  source_text text not null,
  target_text text not null,
  source_hash text not null,
  target_hash text not null,
  source_normalized text not null,
  client_id uuid references public.clients(id) on delete set null,
  sector_id uuid references public.sectors(id) on delete set null,
  project_names text[] not null default '{}',
  origin text not null default 'tmx-import'
    check (origin in ('tmx-import', 'human-approved', 'engine')),
  quality text not null default 'draft'
    check (quality in ('approved', 'draft')),
  context_pre text,
  context_post text,
  import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by text
);

-- Tekilleştirme anahtarı (spec 5.3)
create unique index if not exists tm_segments_dedupe_idx
  on public.tm_segments (source_lang, target_lang, source_hash, target_hash);

-- Birebir eşleşme
create index if not exists tm_segments_exact_idx
  on public.tm_segments (source_lang, target_lang, source_hash);

-- Bulanık eşleşme
create index if not exists tm_segments_trgm_idx
  on public.tm_segments using gin (source_normalized gin_trgm_ops);

-- Erişim: yalnızca service-role -----------------------------------------

alter table public.sectors        enable row level security;
alter table public.clients        enable row level security;
alter table public.imports        enable row level security;
alter table public.term_concepts  enable row level security;
alter table public.term_variants  enable row level security;
alter table public.tm_segments    enable row level security;

revoke all on public.sectors       from anon, authenticated;
revoke all on public.clients       from anon, authenticated;
revoke all on public.imports       from anon, authenticated;
revoke all on public.term_concepts from anon, authenticated;
revoke all on public.term_variants from anon, authenticated;
revoke all on public.tm_segments   from anon, authenticated;
