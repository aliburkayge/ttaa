# Supabase content and image backup

The application uses Supabase from server-only code to archive completed content packages. The service-role key is never exposed to the browser.

## Environment values

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` must not use the `NEXT_PUBLIC_` prefix. Image generation calls OpenAI directly from the local server; no Supabase Edge Function or client-side provider key is used.

## Active persistence flow

1. The full article, HTML/CSS, schema, SEO and image prompts are assembled privately.
2. OpenAI generates a featured image and an inline image in parallel.
3. Both files are uploaded to WordPress Media Library and privately backed up to `ttaa-blog-images`.
4. The featured image is assigned to `featured_media`; the inline image is inserted as a semantic `<figure>`.
5. The server creates the WordPress post with status `draft` and archives the completed JSON record in `ttaa-content-packages`.
6. Only after finalization completes does the client display the package.

Each content record contains the source brief, completed package, image metadata, WordPress post reference, creator email and timestamp. `ttaa-content-packages` is private and accepts JSON only. `ttaa-blog-images` is also private and accepts WebP, JPEG and PNG up to 10 MB.

The migration under `supabase/migrations/` is optional for a future queryable table; the current integration does not require it.

Supabase backup failure does not delete a valid WordPress draft; the studio returns a visible warning. OpenAI generation or WordPress media upload failure blocks draft creation. If WordPress media succeeds but draft creation fails, only the two exact media IDs created by that run are removed.
