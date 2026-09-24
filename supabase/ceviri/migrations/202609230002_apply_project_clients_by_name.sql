-- Proje eşlemesini yalnızca verilen projelerin satırlarına uygular.
--
-- 73 bin satırın hepsini tek istekte güncellemek PostgREST'in istek süresi
-- sınırına takıldı (ilk dağıtım veritabanında doğrudan çalıştırıldı). Bir
-- projenin kararı değişince yalnızca o projenin satırları yeniden hesaplanır;
-- toplu dağıtım betiği adları parça parça verir. Satırın kararı yine bütün
-- proje adlarına bakılarak verilir (bkz. project-firms.ts rowClientId).

drop function if exists public.apply_project_clients();
drop function if exists public.preview_project_clients();

create or replace function public.preview_project_clients(p_names text[] default null)
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
      and (p_names is null or s.project_names && p_names)
    group by s.id
  )
  select target, count(*) from decided group by target;
$$;

create or replace function public.apply_project_clients(p_names text[] default null)
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
      and (p_names is null or s.project_names && p_names)
    group by s.id
  ), updated as (
    update public.tm_segments s set client_id = d.target
    from decided d
    where s.id = d.id and s.client_id is distinct from d.target
    returning s.client_id as cid
  )
  select cid, count(*) from updated group by cid;
$$;

revoke all on function public.apply_project_clients(text[]) from public, anon, authenticated;
revoke all on function public.preview_project_clients(text[]) from public, anon, authenticated;
