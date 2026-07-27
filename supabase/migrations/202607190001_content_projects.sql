create extension if not exists pgcrypto;

create table if not exists public.content_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  status text not null default 'complete' check (status in ('brief', 'content_generating', 'content_ready_private', 'image_generating', 'assembling', 'complete', 'failed')),
  brief jsonb not null default '{}'::jsonb,
  content_package jsonb not null default '{}'::jsonb,
  wordpress_post_id bigint,
  wordpress_post_url text,
  wordpress_status text check (wordpress_status is null or wordpress_status = 'draft'),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_projects_created_at_idx on public.content_projects (created_at desc);
create unique index if not exists content_projects_wordpress_post_id_idx on public.content_projects (wordpress_post_id) where wordpress_post_id is not null;

alter table public.content_projects enable row level security;

comment on table public.content_projects is 'Server-managed TTAA content packages and WordPress draft references. Access is restricted to the service role.';
