-- tm_segments'e toplu yazarken çakışan satırların project_names dizisini
-- kaybetmeden birleştiren fonksiyon.
--
-- insertTmRows önceden `.upsert(..., { ignoreDuplicates: true })` kullanıyordu,
-- yani ON CONFLICT DO NOTHING: aynı (source_lang, target_lang, source_hash,
-- target_hash) anahtarına ikinci kez rastlanan bir satır bütünüyle atılıyor,
-- taşıdığı proje etiketi hiçbir zaman var olan satıra eklenmiyordu. Bu fonksiyon
-- bunun yerine ON CONFLICT DO UPDATE ile mevcut ve gelen project_names
-- dizilerinin ayrık birleşimini (distinct union) yazar.
create or replace function public.upsert_tm_segments(p_rows jsonb)
returns table (inserted_count integer, merged_count integer)
language plpgsql
as $$
begin
  return query
  with input_rows as (
    select
      x.source_lang,
      x.target_lang,
      x.source_text,
      x.target_text,
      x.source_hash,
      x.target_hash,
      x.source_normalized,
      coalesce(x.project_names, '{}'::text[]) as project_names,
      x.origin,
      x.context_pre,
      x.context_post,
      x.import_id,
      x.client_id,
      x.sector_id
    from jsonb_to_recordset(p_rows) as x (
      source_lang text,
      target_lang text,
      source_text text,
      target_text text,
      source_hash text,
      target_hash text,
      source_normalized text,
      project_names text[],
      origin text,
      context_pre text,
      context_post text,
      import_id uuid,
      client_id uuid,
      sector_id uuid
    )
  ),
  -- ÖNEMLİ: p_rows, dedupeRows() ile parti-içi tekilleştirmeden geçmiş olmalı.
  -- Aynı çağrıda aynı (source_lang, target_lang, source_hash, target_hash)
  -- anahtarına sahip iki satır varsa Postgres
  -- "ON CONFLICT DO UPDATE command cannot affect row a second time" hatası
  -- verir. dedupeRows artık yalnızca verimlilik için değil, doğruluk için de
  -- zorunlu bir ön koşuldur — bu fonksiyonu çağırmadan önce atlamayın.
  upserted as (
    insert into public.tm_segments (
      source_lang, target_lang, source_text, target_text,
      source_hash, target_hash, source_normalized, project_names,
      origin, context_pre, context_post, import_id, client_id, sector_id
    )
    select
      source_lang, target_lang, source_text, target_text,
      source_hash, target_hash, source_normalized, project_names,
      origin, context_pre, context_post, import_id, client_id, sector_id
    from input_rows
    on conflict (source_lang, target_lang, source_hash, target_hash)
    do update set
      project_names = (
        select coalesce(array_agg(distinct tag), '{}'::text[])
        from unnest(public.tm_segments.project_names || excluded.project_names) as tag
      ),
      context_pre = coalesce(public.tm_segments.context_pre, excluded.context_pre),
      context_post = coalesce(public.tm_segments.context_post, excluded.context_post)
    returning (xmax = 0) as was_insert
  )
  select
    count(*) filter (where was_insert)::integer as inserted_count,
    count(*) filter (where not was_insert)::integer as merged_count
  from upserted;
end;
$$;

-- Erişim: yalnızca service-role. Diğer nesnelerle aynı desen
-- (202609190001_knowledge_base.sql'deki revoke satırlarına bakın).
revoke all on function public.upsert_tm_segments(jsonb) from public, anon, authenticated;
