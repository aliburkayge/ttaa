-- Firma kütüphanesi ve firmaya göre çeviri.
-- Spec: docs/superpowers/specs/2026-09-23-firma-kutuphanesi-design.md (bölüm 4, 5.1, 5.3)
--
-- Geriye uyumlu: search_tm / lookup_terms / upsert_tm_segments imzaları
-- değişmez; canlıda çalışan eski sürüm onları kullanmaya devam eder. Yeni kod
-- *_scoped sürümlerini çağırır.

alter table public.clients
  add column if not exists aliases text[] not null default '{}',
  add column if not exists instructions text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ceviri_documents
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists maker_id uuid references public.clients(id) on delete set null,
  add column if not exists detection jsonb;
create index if not exists ceviri_documents_client_idx on public.ceviri_documents (client_id);

alter table public.tm_segments drop constraint if exists tm_segments_origin_check;
alter table public.tm_segments add constraint tm_segments_origin_check
  check (origin in ('tmx-import', 'human-approved', 'engine', 'reference'));
create index if not exists tm_segments_client_idx on public.tm_segments (client_id);
create index if not exists tm_segments_project_names_idx on public.tm_segments using gin (project_names);

alter table public.imports add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.imports drop constraint if exists imports_kind_check;
alter table public.imports add constraint imports_kind_check
  check (kind in ('tmx', 'termbase-xlsx', 'reference-archive', 'reference-pair'));

-- Proje adı → firma. client_id null + pending false: bilinçli olarak genel.
create table if not exists public.project_clients (
  project_name text primary key,
  client_id uuid references public.clients(id) on delete cascade,
  decided_by text not null check (decided_by in ('name', 'text', 'fingerprint', 'user')),
  pending boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Firma parmak izi: firmayı ayırt eden özel adlar ve kodlar (katlanmış).
create table if not exists public.client_signatures (
  client_id uuid not null references public.clients(id) on delete cascade,
  token text not null,
  weight real not null,
  rows int not null,
  primary key (client_id, token)
);
create index if not exists client_signatures_token_idx on public.client_signatures (token);

create table if not exists public.term_suggestions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_lang text not null,
  target_lang text not null,
  source_text text not null,
  target_text text not null,
  kind text not null check (kind in ('extracted', 'edit', 'conflict')),
  score real not null default 0,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (client_id, source_lang, target_lang, source_text, target_text)
);

alter table public.project_clients   enable row level security;
alter table public.client_signatures enable row level security;
alter table public.term_suggestions  enable row level security;
revoke all on public.project_clients   from anon, authenticated;
revoke all on public.client_signatures from anon, authenticated;
revoke all on public.term_suggestions  from anon, authenticated;

-- Bellek araması, kapsam zinciriyle (spec 5.1). Sıra düzeltilmiş skorla,
-- kullanım kararı çağıranda ham skorla (score) verilir.
create or replace function public.search_tm_scoped(
  p_source_normalized text,
  p_source_hash text,
  p_source_lang text,
  p_target_lang text,
  p_client_ids uuid[] default '{}',
  p_sector_id uuid default null,
  p_min_score real default 0.75,
  p_limit integer default 10
)
returns table (
  id uuid, source_text text, target_text text, score real, adjusted real,
  origin text, quality text, project_names text[], client_id uuid, sector_id uuid
)
language sql stable
as $$
  with scored as (
    select s.id as sid, s.source_text as src, s.target_text as tgt, s.origin as org,
      s.quality as qual, s.project_names as names, s.client_id as cid, s.sector_id as sec,
      s.created_at as made,
      case when s.source_hash = p_source_hash then 1.0::real
           else extensions.similarity(s.source_normalized, p_source_normalized) end as raw
    from public.tm_segments s
    where s.source_lang = p_source_lang
      and s.target_lang = p_target_lang
      and (s.source_hash = p_source_hash
           or s.source_normalized operator(extensions.%) p_source_normalized)
  )
  select sid, src, tgt, raw,
    (raw
      + case when cid is not null and cid = p_client_ids[1] then 0.06
             when cid is not null and cid = p_client_ids[2] then 0.04
             else 0 end
      + case when p_sector_id is not null and sec = p_sector_id then 0.02 else 0 end
      + case when org in ('human-approved', 'reference') then 0.03 else 0 end)::real,
    org, qual, names, cid, sec
  from scored
  where raw >= p_min_score
  order by 5 desc, made asc
  limit p_limit;
$$;

create or replace function public.lookup_terms_scoped(
  p_text text,
  p_source_lang text,
  p_target_lang text,
  p_client_ids uuid[] default '{}',
  p_sector_id uuid default null
)
returns table (
  concept_id uuid, scope_type text, scope_id uuid, source_text text,
  target_text text, is_forbidden boolean, notes text
)
language sql stable
as $$
  select c.id, c.scope_type, c.scope_id, src.text, tgt.text, tgt.is_forbidden, tgt.notes
  from public.term_concepts c
  join public.term_variants src on src.concept_id = c.id and src.lang = p_source_lang
  join public.term_variants tgt on tgt.concept_id = c.id and tgt.lang = p_target_lang
  where position(src.normalized in p_text) > 0
    and (c.scope_type = 'global'
         or (c.scope_type = 'sector' and c.scope_id = p_sector_id)
         or (c.scope_type = 'client' and c.scope_id = any(p_client_ids)));
$$;

create or replace function public.client_library_stats()
returns table (client_id uuid, memory bigint, terms bigint, documents bigint, suggestions bigint)
language sql stable
as $$
  select c.id,
    (select count(*) from public.tm_segments s where s.client_id = c.id),
    (select count(*) from public.term_concepts t where t.scope_type = 'client' and t.scope_id = c.id),
    (select count(*) from public.ceviri_documents d where d.client_id = c.id),
    (select count(*) from public.term_suggestions g where g.client_id = c.id and g.status = 'pending')
  from public.clients c;
$$;

-- Eski belleğin dağıtılması (spec 5.3): satırın bütün proje adları aynı
-- firmaya eşleniyorsa o firma; eşlenmemiş, bekleyen, genel ya da farklı
-- firmalara eşlenen ad varsa null. Yalnızca tmx-import satırları: düzeltme ve
-- referans satırları firmasını belgesinden alır. "lingua-düzeltme" etiketi
-- sayılmaz.
create or replace function public.preview_project_clients()
returns table (client_id uuid, rows bigint)
language sql stable
as $$
  with decided as (
    select s.id,
      case when bool_or(pc.project_name is null or pc.pending or pc.client_id is null) then null
           when count(distinct pc.client_id) = 1 then min(pc.client_id::text)::uuid
           else null end as target
    from public.tm_segments s
    cross join lateral unnest(s.project_names) as n(name)
    left join public.project_clients pc on pc.project_name = n.name
    where s.origin = 'tmx-import' and n.name <> 'lingua-düzeltme'
    group by s.id
  )
  select target, count(*) from decided group by target;
$$;

create or replace function public.apply_project_clients()
returns table (client_id uuid, rows bigint)
language sql
as $$
  with decided as (
    select s.id,
      case when bool_or(pc.project_name is null or pc.pending or pc.client_id is null) then null
           when count(distinct pc.client_id) = 1 then min(pc.client_id::text)::uuid
           else null end as target
    from public.tm_segments s
    cross join lateral unnest(s.project_names) as n(name)
    left join public.project_clients pc on pc.project_name = n.name
    where s.origin = 'tmx-import' and n.name <> 'lingua-düzeltme'
    group by s.id
  ), updated as (
    update public.tm_segments s set client_id = d.target
    from decided d
    where s.id = d.id and s.client_id is distinct from d.target
    returning s.client_id as cid
  )
  select cid, count(*) from updated group by cid;
$$;

revoke all on function public.apply_project_clients() from public, anon, authenticated;
revoke all on function public.preview_project_clients() from public, anon, authenticated;
