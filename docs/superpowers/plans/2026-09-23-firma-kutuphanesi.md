# Firma Kütüphanesi Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her firmanın kendi terimce, bellek ve referans kütüphanesi olur; belge yüklenirken firma otomatik tespit edilir ya da seçilir; çeviri müşteri → üretici → sektör → genel zinciriyle beslenir; sistem referans çiftlerinden ve düzeltmelerden firmaya özel terim öğrenir.

**Architecture:** Algoritmalar (katlama, kapsam zinciri, parmak izi, tespit, Gale-Church hizalama, dosya eşleme, terim çıkarma, düzeltmeden öğrenme) `lib/ceviri/` altında saf fonksiyonlardır ve `node --test` ile veritabanısız sınanır. Veritabanı erişimi ayrı `*-store.ts` / route katmanındadır. Şema değişikliği tek, geriye uyumlu bir migration'dır: eski `search_tm`/`lookup_terms` imzaları durur (canlı Railway sürümü onları kullanır), yeni kod `*_scoped` sürümlerini çağırır.

**Tech Stack:** Next.js 16 (app router, route handlers), TypeScript, Supabase (Postgres + pg_trgm), fflate (zip), node:test + tsx.

**Spec:** `docs/superpowers/specs/2026-09-23-firma-kutuphanesi-design.md`

## Global Constraints

- Supabase çeviri projesi: `bmtmqywcrkxahxofrnib`. Migration dosyaları `supabase/ceviri/migrations/` altında; veritabanına Supabase bağlayıcısının `apply_migration` aracıyla uygulanır.
- Yeni tablolarda RLS açık, `anon`/`authenticated` revoke; erişim yalnızca service-role (mevcut desen).
- Eski RPC imzaları (`search_tm`, `lookup_terms`, `upsert_tm_segments`) değiştirilmez.
- Testler: `node --import tsx --test tests/<dosya>.test.ts`; test dosyaları `.ts` uzantılı import eder (`../lib/ceviri/x.ts`).
- Kod yorumları Türkçe, mevcut dosyaların üslubunda; arayüz metinleri Türkçe.
- Route'lar `requireAdminSession()` ile korunur; `UNAUTHORIZED` → 401 "Oturumunuz sona erdi.", diğer hatalar 500 + mesaj.
- Kapsam payları (spec 5.1): müşteri 0,06 · üretici 0,04 · sektör 0,02 · `human-approved`/`reference` 0,03. Kullanım kararı ham skorla.
- Tespit eşikleri (spec 5.2): `puan = 3·min(ad,3) + min(iz,10) + 2·min(bellek,15)`; otomatik ≥ 6 ve ≥ 2× ikinci; öneri ≥ 3 ve ≥ 1,5× ikinci; üretici ≥ 2 ad eşleşmesi.
- Parmak izi kuralları: en az 2 belge ve 3 satır, ≥ %90 tek firmada, ≤ 25 belgede, özel ad oranı ≥ %80.
- Terim çıkarma: firmada ≥ 3 geçiş, G² ≥ 10,83, Dice ≥ 0,5, birlikte ≥ 3; kök = 7+ harfli kelimede ilk 6 harf.
- Commit adımları yalnızca kullanıcı commit istediğinde çalıştırılır; diğer her adım durmadan yürütülür.
- Eski arşiv tarama çıktıları (`firma-gruplari.tsv`, `belirsiz-siniflandirma.tsv`) kişisel proje adları içerir; repoya girmez, `.claude/firma-tarama/` altında durur (izlenmeyen klasör).

## Dosya haritası

| Dosya | Sorumluluk | Görev |
|---|---|---|
| `supabase/ceviri/migrations/202609230001_client_library.sql` | şema, `*_scoped` RPC'ler, dağıtım RPC'leri, istatistik | 1 |
| `lib/ceviri/fold.ts` | kelime katlama, kelime/kod çıkarma, özel ad sayımı | 2 |
| `lib/ceviri/scope.ts` | kapsam zinciri, terim sıralama, bellek payı | 3 |
| `lib/ceviri/term-store.ts` (değişir) | zincirli terim araması | 4 |
| `lib/ceviri/tm-store.ts` (değişir) | zincirli bellek araması, düzeltilmiş sıralama | 4 |
| `lib/ceviri/translate.ts` (değişir) | prompt'a firma terimi farkı ve firma talimatı | 4 |
| `lib/ceviri/clients.ts` | firma CRUD, slug, belge için zincir | 5 |
| `lib/ceviri/project-firms.ts` | proje adı → firma, tarama tablolarını okuma | 5 |
| `app/api/ceviri/clients/route.ts`, `[id]/route.ts` | firma listesi/oluşturma/ayrıntı/güncelleme | 5 |
| `scripts/ceviri-backfill-clients.ts` | eski arşivin dağıtılması | 6 |
| `app/api/ceviri/projects/route.ts` | karar bekleyen projeler | 6 |
| `app/api/ceviri/documents/route.ts`, `[id]/route.ts`, `[id]/translate/route.ts` (değişir) | belgede firma, değiştirme, zincirli çeviri | 7 |
| `app/ceviri-app/firm-picker.tsx`, `lingua.tsx`, `lingua.module.css` | yüklemede firma, belge rozeti | 8 |
| `app/ceviri-app/firmalar/*` , `firms.module.css` | firma listesi ve firma sayfası | 8, 9, 10, 12, 16 |
| `app/api/ceviri/clients/[id]/terms/route.ts` | firma terimcesi | 9 |
| `app/api/ceviri/clients/[id]/imports/route.ts` | xlsx/TMX içe aktarımı | 10 |
| `lib/ceviri/align.ts` | Gale-Church + çapa hizalaması | 11 |
| `lib/ceviri/pair-files.ts` | zip içindeki kaynak/çeviri dosya eşleme | 12 |
| `lib/ceviri/reference-import.ts` | çiftten metin çıkarma, hizalama, doğrulama, belleğe yazma | 12 |
| `app/api/ceviri/clients/[id]/references/route.ts`, `references/zip/route.ts` | referans yükleme | 12 |
| `lib/ceviri/signatures.ts` | parmak izi kurma | 13 |
| `app/api/ceviri/clients/signatures/route.ts` | parmak izini yeniden kurma | 13 |
| `lib/ceviri/detect-client.ts` | ad eşleşmesi, puanlama, karar | 14 |
| `lib/ceviri/client-detection-store.ts` | belge için kanıt toplama | 14 |
| `scripts/ceviri-eval-detection.ts` | kalibrasyon ölçümü | 15 |
| `lib/ceviri/term-mining.ts` | G² + Dice terim çıkarma | 16 |
| `lib/ceviri/suggestion-store.ts` | öneri yazma/okuma/kabul | 16 |
| `app/api/ceviri/clients/[id]/suggestions/route.ts` | öneriler | 16 |
| `lib/ceviri/edit-learning.ts` | kelime farkı → düzeltme gözlemi | 17 |
| `app/api/ceviri/documents/[id]/segments/route.ts` (değişir) | düzeltmede firma ve gözlem | 17 |

---

## FAZ 1 — Firmalar ve firmaya göre çeviri

### Task 1: Migration

**Files:**
- Create: `supabase/ceviri/migrations/202609230001_client_library.sql`

**Interfaces:**
- Produces: tablolar `project_clients`, `client_signatures`, `term_suggestions`; sütunlar `clients.aliases/instructions/updated_at`, `ceviri_documents.client_id/maker_id/detection`, `imports.client_id`; `tm_segments.origin` artık `'reference'` alır; RPC'ler `search_tm_scoped(p_source_normalized, p_source_hash, p_source_lang, p_target_lang, p_client_ids uuid[], p_sector_id, p_min_score, p_limit)` → `(id, source_text, target_text, score, adjusted, origin, quality, project_names, client_id, sector_id)`, `lookup_terms_scoped(p_text, p_source_lang, p_target_lang, p_client_ids uuid[], p_sector_id)` → `(concept_id, scope_type, scope_id, source_text, target_text, is_forbidden, notes)`, `client_library_stats()` → `(client_id, memory, terms, documents, suggestions)`, `preview_project_clients()` / `apply_project_clients()` → `(client_id, rows)`.

- [ ] **Step 1: Migration dosyasını yaz**

```sql
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

revoke all on function public.apply_project_clients() from anon, authenticated;
revoke all on function public.preview_project_clients() from anon, authenticated;
```

- [ ] **Step 2: Veritabanına uygula**

Supabase bağlayıcısı: `apply_migration(project_id="bmtmqywcrkxahxofrnib", name="client_library", query=<dosyanın içeriği>)`.

- [ ] **Step 3: Doğrula**

`execute_sql`:
```sql
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('search_tm_scoped','lookup_terms_scoped','client_library_stats','preview_project_clients','apply_project_clients','search_tm','lookup_terms');
select count(*) from public.search_tm_scoped('active ingredient', 'x', 'en-US', 'tr-TR', '{}', null, 0.6, 5);
select * from public.client_library_stats();
```
Beklenen: 7 fonksiyon; arama hatasız döner; üç firma satırı (0 değerlerle).

- [ ] **Step 4: Commit**

```bash
git add supabase/ceviri/migrations/202609230001_client_library.sql
git commit -m "Firma kütüphanesi şeması: kapsamlı arama, proje eşlemesi, parmak izi, öneriler"
```

---

### Task 2: Kelime katlama (`fold.ts`)

**Files:**
- Create: `lib/ceviri/fold.ts`
- Test: `tests/ceviri-fold.test.ts`

**Interfaces:**
- Produces: `fold(word: string): string`, `tokensOf(text: string): string[]`, `type CaseCounts = { proper: Map<string, number>; all: Map<string, number> }`, `countCase(texts: Iterable<string>, into?: CaseCounts): CaseCounts`, `isProper(token: string, counts: CaseCounts): boolean`.

- [ ] **Step 1: Testi yaz**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { countCase, fold, isProper, tokensOf } from "../lib/ceviri/fold.ts";

test("folds Turkish capitals onto the lower-case word", () => {
  assert.equal(fold("GEREKLİLİK"), fold("gereklilik"));
  assert.equal(fold("DEPOLANMASI"), fold("depolanması"));
  assert.equal(fold("İzmir"), "izmir");
});

test("collects words and product codes", () => {
  const tokens = tokensOf("Product BAS 703 07 F and A20570A, see RP-0420.");
  assert.ok(tokens.includes("bas 703 07 f"));
  assert.ok(tokens.includes("a20570a"));
  assert.ok(tokens.includes("rp-0420"));
  assert.ok(tokens.includes("product"));
  assert.equal(tokens.includes("and"), false, "words shorter than four letters are skipped");
});

test("a product name is proper, an everyday word is not", () => {
  const counts = countCase([
    "We apply Touchdown here.",
    "Always use Touchdown carefully.",
    "The workplace is safe.",
    "A clean workplace matters.",
    "WORKPLACE RULES",
  ]);
  assert.equal(isProper("touchdown", counts), true);
  assert.equal(isProper("workplace", counts), false);
  assert.equal(isProper("bas 703 07 f", counts), true, "codes are always proper");
});
```

- [ ] **Step 2: Başarısız olduğunu gör**

Run: `node --import tsx --test tests/ceviri-fold.test.ts`
Expected: FAIL — `Cannot find module '../lib/ceviri/fold.ts'`

- [ ] **Step 3: Uygula**

```ts
/**
 * Firma adı ve parmak izi karşılaştırmaları için kelime katlama.
 *
 * Küçük harfe çevirmede "İ" → "i̇" (i + U+0307) olur; nokta atılır ve "ı" da
 * "i" sayılır. Büyük harfli Türkçe başlıklar ("GEREKLİLİK", "DEPOLANMASI")
 * böylece küçük yazılmış hâlleriyle aynı kelimeye düşer; eski arşiv
 * taramasında hiç küçük harfle görülmedikleri için özel ad sanılıyorlardı.
 */
export function fold(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/̇/g, "")
    .normalize("NFC")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD = /[\p{L}][\p{L}\p{N}-]{3,}/gu;
/** Ürün ve ruhsat kodları: "BAS 703 07 F", "EC 1107", "A20570A". */
const CODE = /\b[A-Z]{1,4}[\s-]?\d{2,5}(?:[\s-]\d{2,3}){0,2}(?:\s?[A-Z])?\b/g;

/** Metindeki kelimeler (4+ harf) ve kodlar, katlanmış ve tekil. */
export function tokensOf(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.match(WORD) ?? []) out.add(fold(match));
  for (const match of text.match(CODE) ?? []) out.add(fold(match));
  return [...out];
}

export type CaseCounts = { proper: Map<string, number>; all: Map<string, number> };

/**
 * Her kelimenin kaç kez geçtiği ve kaçında "özel ad gibi" yazıldığı: cümle
 * ortasında büyük harfle başlıyor, tamamen büyük harfli ya da rakam içeriyor.
 */
export function countCase(texts: Iterable<string>, into?: CaseCounts): CaseCounts {
  const counts = into ?? { proper: new Map(), all: new Map() };
  for (const text of texts) {
    const words = text.match(WORD) ?? [];
    words.forEach((word, index) => {
      const key = fold(word);
      counts.all.set(key, (counts.all.get(key) ?? 0) + 1);
      const coded = /\d/.test(word) || (word.length >= 3 && word === word.toUpperCase() && /\p{Lu}/u.test(word));
      if (coded || (index > 0 && /^\p{Lu}/u.test(word))) counts.proper.set(key, (counts.proper.get(key) ?? 0) + 1);
    });
  }
  return counts;
}

/**
 * Ürün adı ve kod cümle ortasında da büyük harfle yazılır (Touchdown, AMPLIGO,
 * BAS 703 07 F); sıradan kelime ("workplace") çoğunlukla küçük harflidir.
 * Taramada bu şart olmadan "workplace", "patient" gibi kelimeler firma izi
 * sayılmış, tıbbi bir epikriz Syngenta'ya atanmıştı.
 */
export function isProper(token: string, counts: CaseCounts): boolean {
  if (/\d/.test(token)) return true;
  const all = counts.all.get(token) ?? 0;
  return all >= 2 && (counts.proper.get(token) ?? 0) >= 0.8 * all;
}
```

- [ ] **Step 4: Geçtiğini gör**

Run: `node --import tsx --test tests/ceviri-fold.test.ts` — Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ceviri/fold.ts tests/ceviri-fold.test.ts
git commit -m "Kelime katlama ve özel ad sayımı"
```

---

### Task 3: Kapsam zinciri (`scope.ts`)

**Files:**
- Create: `lib/ceviri/scope.ts`
- Modify: `lib/ceviri/term-store.ts` (yalnızca `TermHit`'e `scopeId` alanı)
- Test: `tests/ceviri-scope.test.ts`

**Interfaces:**
- Consumes: `TermHit` (`lib/ceviri/term-store.ts`)
- Produces: `type ScopeChain = { clientId: string | null; makerId: string | null; sectorId: string | null }`, `NO_SCOPE`, `chainClientIds(chain): string[]`, `termRank(hit, chain): number`, `type ScopedTerms = { preferred: TermHit[]; forbidden: TermHit[]; replaced: Array<{ term: TermHit; by: TermHit }> }`, `pickScoped(hits: TermHit[], chain: ScopeChain): ScopedTerms`, `SCOPE_BONUS`, `adjustedScore(match: { score: number; client_id?: string | null; sector_id?: string | null; origin: string }, chain: ScopeChain): number`.

- [ ] **Step 1: `TermHit`'e alan ekle** — `lib/ceviri/term-store.ts` içinde:

```ts
export type TermHit = {
  conceptId: string;
  scopeType: string;
  /** Firma ya da sektör kapsamında hangi firma/sektör; genelde null. */
  scopeId?: string | null;
  sourceText: string;
  targetText: string;
  isForbidden: boolean;
  notes: string | null;
};
```

- [ ] **Step 2: Testi yaz** — `tests/ceviri-scope.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { adjustedScore, chainClientIds, pickScoped, termRank, type ScopeChain } from "../lib/ceviri/scope.ts";
import type { TermHit } from "../lib/ceviri/term-store.ts";

const CHAIN: ScopeChain = { clientId: "nase", makerId: "syngenta", sectorId: "zirai" };

function hit(partial: Partial<TermHit>): TermHit {
  return { conceptId: "c", scopeType: "global", scopeId: null, sourceText: "registration", targetText: "tescil", isForbidden: false, notes: null, ...partial };
}

test("the chain lists the customer before the maker, without duplicates", () => {
  assert.deepEqual(chainClientIds(CHAIN), ["nase", "syngenta"]);
  assert.deepEqual(chainClientIds({ clientId: "basf", makerId: "basf", sectorId: null }), ["basf"]);
  assert.deepEqual(chainClientIds({ clientId: null, makerId: null, sectorId: null }), []);
});

test("customer outranks maker outranks sector outranks general; other firms do not count", () => {
  assert.equal(termRank(hit({ scopeType: "client", scopeId: "nase" }), CHAIN), 4);
  assert.equal(termRank(hit({ scopeType: "client", scopeId: "syngenta" }), CHAIN), 3);
  assert.equal(termRank(hit({ scopeType: "sector", scopeId: "zirai" }), CHAIN), 2);
  assert.equal(termRank(hit({}), CHAIN), 1);
  assert.equal(termRank(hit({ scopeType: "client", scopeId: "bayer" }), CHAIN), 0);
});

test("the customer's term wins and the general one is recorded as replaced, not forbidden", () => {
  const general = hit({ conceptId: "g", targetText: "tescil" });
  const firm = hit({ conceptId: "f", scopeType: "client", scopeId: "nase", targetText: "ruhsat" });
  const result = pickScoped([general, firm], CHAIN);
  assert.deepEqual(result.preferred.map((h) => h.targetText), ["ruhsat"]);
  assert.deepEqual(result.replaced.map((r) => [r.term.targetText, r.by.targetText]), [["tescil", "ruhsat"]]);
  assert.deepEqual(result.forbidden, []);
});

test("a general prohibition stays unless a narrower scope prefers that very word", () => {
  const banned = hit({ conceptId: "g", targetText: "kayıt", isForbidden: true });
  assert.equal(pickScoped([banned], CHAIN).forbidden.length, 1);
  const firmWants = hit({ conceptId: "f", scopeType: "client", scopeId: "nase", targetText: "kayıt" });
  assert.equal(pickScoped([banned, firmWants], CHAIN).forbidden.length, 0);
});

test("another firm's terms are ignored entirely", () => {
  const bayer = hit({ scopeType: "client", scopeId: "bayer", targetText: "ruhsatlandırma" });
  const general = hit({ targetText: "tescil" });
  assert.deepEqual(pickScoped([bayer, general], CHAIN).preferred.map((h) => h.targetText), ["tescil"]);
});

test("a firm's 95% match outranks a stranger's 100% match, but raw score is kept", () => {
  const own = { score: 0.95, client_id: "nase", sector_id: null, origin: "tmx-import" };
  const stranger = { score: 1, client_id: "bayer", sector_id: null, origin: "tmx-import" };
  assert.ok(adjustedScore(own, CHAIN) > adjustedScore(stranger, CHAIN));
  assert.equal(own.score, 0.95);
  const approved = { score: 0.9, client_id: null, sector_id: null, origin: "human-approved" };
  assert.ok(Math.abs(adjustedScore(approved, CHAIN) - 0.93) < 1e-9);
});
```

- [ ] **Step 3: Başarısız olduğunu gör** — `node --import tsx --test tests/ceviri-scope.test.ts` → FAIL (modül yok).

- [ ] **Step 4: Uygula** — `lib/ceviri/scope.ts`

```ts
import type { TermHit } from "./term-store";

/**
 * Bir belgenin kapsam zinciri (spec 5.1): müşteri → üretici → sektör → genel.
 * Müşteri işi getiren firmadır (Nase); üretici belgede ürünü geçen firmadır
 * (Syngenta). Eski arşivde Nase projelerinin metninde en çok Bayer ve Syngenta
 * geçiyordu: ikisi ayrı şeylerdir.
 */
export type ScopeChain = { clientId: string | null; makerId: string | null; sectorId: string | null };

export const NO_SCOPE: ScopeChain = { clientId: null, makerId: null, sectorId: null };

/** Veritabanına gidecek firma listesi, öncelik sırasıyla ve tekil. */
export function chainClientIds(chain: ScopeChain): string[] {
  return [...new Set([chain.clientId, chain.makerId].filter((id): id is string => Boolean(id)))];
}

/** 4 müşteri, 3 üretici, 2 sektör, 1 genel; zincirde olmayan firma/sektör 0. */
export function termRank(hit: { scopeType: string; scopeId?: string | null }, chain: ScopeChain): number {
  if (hit.scopeType === "client") {
    if (hit.scopeId && hit.scopeId === chain.clientId) return 4;
    if (hit.scopeId && hit.scopeId === chain.makerId) return 3;
    return 0;
  }
  if (hit.scopeType === "sector") return hit.scopeId && hit.scopeId === chain.sectorId ? 2 : 0;
  return 1;
}

export type ScopedTerms = {
  preferred: TermHit[];
  forbidden: TermHit[];
  /** Daha dar kapsamın başka karşılık seçtiği terimler: prompt'ta "X değil" diye yazılır. */
  replaced: Array<{ term: TermHit; by: TermHit }>;
};

const keyOf = (text: string) => text.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

/**
 * Her kaynak ifade için zincirde en üstteki kapsamın karşılığı kazanır. Kaybeden
 * farklı karşılık yasaklı sayılmaz (aynı kelime cümlenin başka yerinde doğru
 * olabilir), `replaced` olarak prompt'a "bunu değil" diye gider. Yasaklı bir
 * karşılık, daha üst kapsam tam o karşılığı tercih etmedikçe yasaklı kalır.
 */
export function pickScoped(hits: TermHit[], chain: ScopeChain): ScopedTerms {
  const usable = hits.filter((hit) => termRank(hit, chain) > 0);
  const best = new Map<string, TermHit>();
  for (const hit of usable) {
    if (hit.isForbidden) continue;
    const key = keyOf(hit.sourceText);
    const current = best.get(key);
    if (!current || termRank(hit, chain) > termRank(current, chain)) best.set(key, hit);
  }

  const replaced = new Map<string, { term: TermHit; by: TermHit }>();
  for (const hit of usable) {
    if (hit.isForbidden) continue;
    const winner = best.get(keyOf(hit.sourceText));
    if (!winner || winner === hit) continue;
    if (termRank(hit, chain) >= termRank(winner, chain)) continue;
    if (keyOf(hit.targetText) === keyOf(winner.targetText)) continue;
    replaced.set(`${keyOf(hit.sourceText)}\u0000${keyOf(hit.targetText)}`, { term: hit, by: winner });
  }

  const forbidden = usable.filter((hit) => {
    if (!hit.isForbidden) return false;
    const winner = best.get(keyOf(hit.sourceText));
    return !(winner && keyOf(winner.targetText) === keyOf(hit.targetText) && termRank(winner, chain) > termRank(hit, chain));
  });

  return { preferred: [...best.values()], forbidden, replaced: [...replaced.values()] };
}

/** Bellek sıralamasında kapsam payları (spec 5.1); SQL'deki search_tm_scoped ile aynı. */
export const SCOPE_BONUS = { client: 0.06, maker: 0.04, sector: 0.02, trusted: 0.03 };

export function adjustedScore(
  match: { score: number; client_id?: string | null; sector_id?: string | null; origin: string },
  chain: ScopeChain,
): number {
  let bonus = 0;
  if (match.client_id && match.client_id === chain.clientId) bonus += SCOPE_BONUS.client;
  else if (match.client_id && match.client_id === chain.makerId) bonus += SCOPE_BONUS.maker;
  if (chain.sectorId && match.sector_id === chain.sectorId) bonus += SCOPE_BONUS.sector;
  if (match.origin === "human-approved" || match.origin === "reference") bonus += SCOPE_BONUS.trusted;
  return match.score + bonus;
}
```

- [ ] **Step 5: Geçtiğini gör** — `node --import tsx --test tests/ceviri-scope.test.ts` → 6 pass.

- [ ] **Step 6: Commit** — `git add lib/ceviri/scope.ts lib/ceviri/term-store.ts tests/ceviri-scope.test.ts && git commit -m "Kapsam zinciri: müşteri, üretici, sektör, genel"`

---

### Task 4: Aramayı ve prompt'u zincire bağla

**Files:**
- Modify: `lib/ceviri/term-store.ts`, `lib/ceviri/tm-store.ts`, `lib/ceviri/translate.ts`
- Test: `tests/ceviri-translate.test.ts` (ekleme), `tests/ceviri-memory-langs.test.ts` çalışmaya devam etmeli

**Interfaces:**
- Consumes: `ScopeChain`, `NO_SCOPE`, `chainClientIds`, `pickScoped`, `adjustedScore` (Task 3)
- Produces: `lookupTerms(query: { sourceText; sourceLang; targetLang; chain?: ScopeChain }): Promise<ScopedTerms>`; `searchTm(query: { sourceText; sourceLang; targetLang; chain?: ScopeChain; limit?; minScore? }): Promise<TmMatch[]>` — `TmMatch` ek alanlar `adjusted?: number; client_id?: string | null; sector_id?: string | null`; `mergeMatches` `adjusted ?? score` ile sıralar; `buildPrompt` export edilir ve `replaced`, `firmInstructions` alır; `translateSegment(..., { ..., scope?: ScopeChain; firmInstructions?: string | null })`.

- [ ] **Step 1: Testleri yaz** — `tests/ceviri-translate.test.ts` sonuna:

```ts
import { buildPrompt } from "../lib/ceviri/translate.ts";
import { mergeMatches, type TmMatch } from "../lib/ceviri/tm-store.ts";

test("the prompt names the company term and the general word it replaces", () => {
  const firm: TermHit = { conceptId: "f", scopeType: "client", scopeId: "basf", sourceText: "registration", targetText: "ruhsat", isForbidden: false, notes: null };
  const general: TermHit = { ...firm, conceptId: "g", scopeType: "global", scopeId: null, targetText: "tescil" };
  const prompt = buildPrompt({
    text: "The registration expires.",
    sourceLang: "en-US",
    targetLang: "tr-TR",
    terms: [firm],
    forbidden: [],
    replaced: [{ term: general, by: firm }],
    similar: [],
    instructions: null,
    firmInstructions: "Adresler çevrilmez.",
  });
  assert.match(prompt, /"registration" must become "ruhsat" \(company term — do NOT use "tescil"\)/);
  assert.match(prompt, /Company rules for this client[\s\S]*Adresler çevrilmez\./);
  assert.ok(prompt.indexOf("Company rules") < prompt.indexOf("Segment:"));
});

test("memory matches merge by adjusted score, falling back to the raw score", () => {
  const row = (id: string, score: number, adjusted?: number): TmMatch => ({ id, source_text: id, target_text: id, score, adjusted, origin: "tmx-import", quality: "draft", project_names: [] });
  const merged = mergeMatches([[row("stranger", 1, 1)], [row("own", 0.95, 1.01)], [row("plain", 0.97)]], 3);
  assert.deepEqual(merged.map((m) => m.id), ["own", "stranger", "plain"]);
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — `node --import tsx --test tests/ceviri-translate.test.ts` → FAIL (`buildPrompt` export yok).

- [ ] **Step 3: `term-store.ts`'i değiştir** — importlara `import { chainClientIds, NO_SCOPE, pickScoped, type ScopeChain, type ScopedTerms } from "./scope";` ekle; `lookupTerms`'i şununla değiştir:

```ts
export async function lookupTerms(query: {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  chain?: ScopeChain;
}): Promise<ScopedTerms> {
  const chain = query.chain ?? NO_SCOPE;
  // İngilizce varyantlar terminolojiyi de paylaşır; eşit kapsamda belgenin
  // kendi varyantının terimi kazanır (çiftler önceliğe göre sıralı).
  const byPair = await Promise.all(
    memoryPairs(query.sourceLang, query.targetLang).map(async ([sourceLang, targetLang]) => {
      const { data, error } = await getCeviriSupabase().rpc("lookup_terms_scoped", {
        p_text: normalizeForMatch(query.sourceText, sourceLang),
        p_source_lang: sourceLang,
        p_target_lang: targetLang,
        p_client_ids: chainClientIds(chain),
        p_sector_id: chain.sectorId,
      });
      if (error) throw new Error(`lookup_terms_scoped failed: ${error.message}`);
      return (data ?? []) as Array<Record<string, unknown>>;
    }),
  );

  const hits: TermHit[] = byPair.flat().map((row) => ({
    conceptId: row.concept_id as string,
    scopeType: row.scope_type as string,
    scopeId: (row.scope_id as string | null) ?? null,
    sourceText: row.source_text as string,
    targetText: row.target_text as string,
    isForbidden: row.is_forbidden as boolean,
    notes: (row.notes as string | null) ?? null,
  }));

  return pickScoped(hits, chain);
}
```

- [ ] **Step 4: `tm-store.ts`'i değiştir** — import: `import { adjustedScore, chainClientIds, NO_SCOPE, type ScopeChain } from "./scope";`. `TmMatch`:

```ts
export type TmMatch = {
  id: string;
  source_text: string;
  target_text: string;
  /** Ham benzerlik: birebir kullanım kararı bununla verilir. */
  score: number;
  /** Kapsam paylarıyla düzeltilmiş skor: yalnızca sıralama (spec 5.1). */
  adjusted?: number;
  origin: string;
  quality: string;
  project_names: string[];
  client_id?: string | null;
  sector_id?: string | null;
};
```

`mergeMatches` sıralaması:

```ts
  const rankOf = (match: TmMatch) => match.adjusted ?? match.score;
  return [...best.values()]
    .sort((a, b) => rankOf(b.match) - rankOf(a.match) || a.rank - b.rank)
    .slice(0, limit)
    .map((entry) => entry.match);
```
ve aynı fonksiyonda `if (!seen || match.score > seen.match.score)` satırı `if (!seen || rankOf(match) > rankOf(seen.match))` olur (`rankOf` fonksiyonun başında tanımlanır).

`searchTm`:

```ts
export async function searchTm(query: {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  chain?: ScopeChain;
  limit?: number;
  minScore?: number;
}): Promise<TmMatch[]> {
  const limit = query.limit ?? 10;
  const chain = query.chain ?? NO_SCOPE;
  const byPair = await Promise.all(
    memoryPairs(query.sourceLang, query.targetLang).map(async ([sourceLang, targetLang]) => {
      const { data, error } = await getCeviriSupabase().rpc("search_tm_scoped", {
        p_source_normalized: normalizeForMatch(query.sourceText, sourceLang),
        p_source_hash: segmentHash(query.sourceText, sourceLang),
        p_source_lang: sourceLang,
        p_target_lang: targetLang,
        p_client_ids: chainClientIds(chain),
        p_sector_id: chain.sectorId,
        p_min_score: query.minScore ?? FUZZY_THRESHOLD,
        p_limit: limit,
      });
      if (error) throw new Error(`search_tm_scoped failed: ${error.message}`);
      return ((data ?? []) as TmMatch[]).map((match) => ({ ...match, adjusted: adjustedScore(match, chain) }));
    }),
  );
  return mergeMatches(byPair, limit);
}
```

- [ ] **Step 5: `translate.ts`'i değiştir** — importlar: `import { lookupTerms, type TermHit } from "./term-store";` kalır; ekle `import type { ScopeChain, ScopedTerms } from "./scope";`. `buildPrompt`'u export et ve imzasına `replaced: ScopedTerms["replaced"]; firmInstructions: string | null;` ekle. Terim bloğu:

```ts
  if (input.terms.length) {
    lines.push("", "Required terminology:");
    for (const term of input.terms) {
      const losers = input.replaced.filter((entry) => entry.by === term).map((entry) => `"${entry.term.targetText}"`);
      const note = losers.length ? ` (company term — do NOT use ${losers.join(" or ")})` : "";
      lines.push(`- "${term.sourceText}" must become "${term.targetText}"${note}`);
    }
  }
```
Talimat bloğunun hemen önüne:

```ts
  if (input.firmInstructions?.trim()) {
    lines.push(
      "",
      "Company rules for this client (always follow them, except where they contradict the required terminology above):",
      input.firmInstructions.trim(),
    );
  }
```
`translateSegment` seçeneklerine:

```ts
    /** Belgenin kapsam zinciri: firmanın terimi ve belleği önce gelir. */
    scope?: ScopeChain;
    /** Firma talimatları (clients.instructions); belge talimatından önce gelir. */
    firmInstructions?: string | null;
```
`query` nesnesine `chain: options.scope` eklenir. `buildPrompt` çağrısına `replaced: termHits.replaced, firmInstructions: options.firmInstructions ?? null` eklenir.

- [ ] **Step 6: Geçtiğini gör** — `node --import tsx --test tests/ceviri-translate.test.ts tests/ceviri-memory-langs.test.ts tests/ceviri-engines.test.ts tests/ceviri-scope.test.ts` → hepsi pass.

- [ ] **Step 7: Arama rotası** — `app/api/ceviri/search/route.ts` `lookupTerms(parsed)` ve `searchTm(...)` çağrıları zinciri vermeden çalışmaya devam eder (varsayılan `NO_SCOPE`); dönen nesnede ek `replaced` alanı zararsızdır. Değişiklik yok; `npx tsc --noEmit -p .` ile `lib/ceviri` ve `app/api/ceviri` altında yeni hata olmadığı doğrulanır.

- [ ] **Step 8: Commit** — `git commit -am "Terim ve bellek araması kapsam zinciriyle; prompt'ta firma terimi farkı ve firma talimatı"`

---

### Task 5: Firmalar (`clients.ts`, `project-firms.ts`, API)

**Files:**
- Create: `lib/ceviri/clients.ts`, `lib/ceviri/project-firms.ts`, `app/api/ceviri/clients/route.ts`, `app/api/ceviri/clients/[id]/route.ts`
- Test: `tests/ceviri-clients.test.ts`

**Interfaces:**
- Consumes: `fold` (Task 2), `ScopeChain` (Task 3)
- Produces:
  - `type Client = { id: string; name: string; slug: string; aliases: string[]; instructions: string | null; default_sector_id: string | null; notes: string | null }`
  - `slugify(name: string): string`, `parseAliases(text: string): string[]`
  - `listClients(): Promise<Client[]>`, `getClient(idOrSlug: string): Promise<Client | null>`, `createClient(input: { name: string; aliases?: string[]; defaultSectorId?: string | null }): Promise<Client>`, `updateClient(id, patch: { name?: string; aliases?: string[]; instructions?: string | null; default_sector_id?: string | null }): Promise<Client>`, `libraryStats(): Promise<Map<string, { memory: number; terms: number; documents: number; suggestions: number }>>`, `scopeFor(doc: { client_id?: string | null; maker_id?: string | null }): Promise<{ chain: ScopeChain; firmInstructions: string | null }>`
  - `firmFromProjectName(name: string): string | null`, `rowClientId(projectNames: string[], mapping: Map<string, string | null>): string | null`, `type ProjectDecision = { name: string; firm: string | null; pending: boolean; decidedBy: "name" | "text" | "fingerprint"; sentences: number; evidence: Record<string, unknown> }`, `readScanTables(groups: string, unresolved: string): ProjectDecision[]`, `DEFAULT_ALIASES: Record<string, { name: string; aliases: string[] }>`
  - `GET /api/ceviri/clients` → `{ clients: Array<Client & { stats }> , pendingProjects: number }`; `POST` `{ name, aliases? }` → `{ client }`; `GET /api/ceviri/clients/[id]` (id ya da slug) → `{ client, stats }`; `PATCH` → `{ client }`.

- [ ] **Step 1: Testi yaz** — `tests/ceviri-clients.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseAliases, slugify } from "../lib/ceviri/clients.ts";
import { firmFromProjectName, readScanTables, rowClientId } from "../lib/ceviri/project-firms.ts";

test("slugs are ASCII, lower case and dash separated", () => {
  assert.equal(slugify("Nase İlaç Tarım"), "nase-ilac-tarim");
  assert.equal(slugify("  BASF  "), "basf");
  assert.equal(slugify("Syngenta Crop Protection AG"), "syngenta-crop-protection-ag");
});

test("aliases are split on commas and new lines, trimmed and de-duplicated", () => {
  assert.deepEqual(parseAliases("Bayer, Bayer CropScience\nBayer Türk Kimya, bayer"), ["Bayer", "Bayer CropScience", "Bayer Türk Kimya"]);
});

test("project names that carry the firm", () => {
  assert.equal(firmFromProjectName("basf 11-08"), "basf");
  assert.equal(firmFromProjectName("syn 25-02"), "syngenta");
  assert.equal(firmFromProjectName("syng 30-04 ru-tr"), "syngenta");
  assert.equal(firmFromProjectName("Syngenta-güncel"), "syngenta");
  assert.equal(firmFromProjectName("NASE-07-10-TR"), "nase");
  assert.equal(firmFromProjectName("synthesis report"), null);
  assert.equal(firmFromProjectName("MATECAT_PROJ-202509181257"), null);
});

test("a memory row belongs to a firm only when every project name agrees", () => {
  const mapping = new Map<string, string | null>([["basf 11-08", "B"], ["basf 12-01", "B"], ["syn 25-02", "S"], ["diploma", null]]);
  assert.equal(rowClientId(["basf 11-08", "basf 12-01"], mapping), "B");
  assert.equal(rowClientId(["basf 11-08", "syn 25-02"], mapping), null, "two firms: shared");
  assert.equal(rowClientId(["basf 11-08", "diploma"], mapping), null, "used outside the firm too");
  assert.equal(rowClientId(["basf 11-08", "unknown"], mapping), null, "unmapped name");
  assert.equal(rowClientId(["basf 11-08", "lingua-düzeltme"], mapping), "B", "correction tag is ignored");
  assert.equal(rowClientId([], mapping), null);
});

test("reads the scan tables: named, fingerprinted, general and pending projects", () => {
  const groups = [
    "firma\tneden\tproje_id\tproje_adi\tcumle\tdiller",
    "basf\tproje adı\t1\tbasf 11-08\t300\ten-tr",
    "syngenta\tmetin (Syngenta:40)\t2\tMATECAT_PROJ-1\t1200\ten-tr",
    "genel\tfirma adı yok\t3\tMATECAT_PROJ-2\t80\ten-tr",
    "?karışık\tSyngenta:11, Globachem:9\t4\tEk2- İtalya Etiketi\t140\tit-tr",
  ].join("\n");
  const unresolved = [
    "sonuc\tguven\tbelge_turu\tproje_id\tproje_adi\tmetin_ogesi\tgerekce",
    "syngenta\tyüksek\tzirai/kimya/ruhsat\t3\tMATECAT_PROJ-2\t160\ttopas, captan",
    "?belirsiz\tsyngenta:11 globachem:9\tzirai/kimya/ruhsat\t4\tEk2- İtalya Etiketi\t283\t",
  ].join("\n");
  const decisions = new Map(readScanTables(groups, unresolved).map((d) => [d.name, d]));
  assert.deepEqual([decisions.get("basf 11-08")?.firm, decisions.get("basf 11-08")?.decidedBy], ["basf", "name"]);
  assert.deepEqual([decisions.get("MATECAT_PROJ-1")?.firm, decisions.get("MATECAT_PROJ-1")?.decidedBy], ["syngenta", "text"]);
  assert.deepEqual([decisions.get("MATECAT_PROJ-2")?.firm, decisions.get("MATECAT_PROJ-2")?.decidedBy], ["syngenta", "fingerprint"]);
  assert.equal(decisions.get("Ek2- İtalya Etiketi")?.pending, true);
  assert.equal(decisions.get("Ek2- İtalya Etiketi")?.firm, null);
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — `node --import tsx --test tests/ceviri-clients.test.ts` → FAIL.

- [ ] **Step 3: `lib/ceviri/project-firms.ts`**

```ts
/**
 * Eski belleğin firmalara dağıtılması (spec 5.3). TMX arşivleri tek müşteriye
 * ait değil: 742 projenin bir kısmı adından (basf…, syn…, nase…), bir kısmı
 * metninde geçen firma adından, bir kısmı da firma parmak izinden bir firmaya
 * bağlandı. Bu modül tarama tablolarını okur ve satır düzeyinde kararı verir.
 */

const NAME_RULES: Array<[RegExp, string]> = [
  [/basf/i, "basf"],
  [/syngenta|^syng?(?=[\s_\-\d]|$)/i, "syngenta"],
  [/(^|[^a-z])nase([^a-z]|$)/i, "nase"],
];

/** Proje adından firma; ad firmayı taşımıyorsa null. */
export function firmFromProjectName(name: string): string | null {
  for (const [pattern, slug] of NAME_RULES) if (pattern.test(name)) return slug;
  return null;
}

/** Çevirmen düzeltmesi etiketi: satırı bir projeye bağlamaz. */
const IGNORED = new Set(["lingua-düzeltme"]);

/**
 * Bir bellek satırının firması: bütün proje adları aynı firmaya eşleniyorsa o
 * firma. Aynı cümle çiftini iki firma kullanıyorsa çeviri zaten aynıdır ve
 * satır ortak (null) kalır. Eşlenmemiş ya da genel bir ad da satırı ortak yapar.
 * SQL'deki apply_project_clients() ile aynı kural.
 */
export function rowClientId(projectNames: string[], mapping: Map<string, string | null>): string | null {
  const names = projectNames.filter((name) => !IGNORED.has(name));
  if (!names.length) return null;
  const ids = names.map((name) => (mapping.has(name) ? mapping.get(name) : undefined));
  if (ids.some((id) => id === undefined || id === null)) return null;
  const unique = new Set(ids);
  return unique.size === 1 ? (ids[0] as string) : null;
}

export type ProjectDecision = {
  name: string;
  firm: string | null;
  pending: boolean;
  decidedBy: "name" | "text" | "fingerprint";
  sentences: number;
  evidence: Record<string, unknown>;
};

function rows(tsv: string): Array<Record<string, string>> {
  const [head, ...lines] = tsv.replace(/\r/g, "").trim().split("\n");
  const columns = head.split("\t");
  return lines.filter(Boolean).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
  });
}

const UNRESOLVED = new Set(["genel", "?karışık"]);

/**
 * Tarama tabloları: `firma-gruplari.tsv` (adı ya da metni belli projeler) ve
 * `belirsiz-siniflandirma.tsv` (geri kalanların parmak izi sonucu). Aynı ada
 * sahip iki proje farklı sonuç verirse ad bekleyene düşer.
 */
export function readScanTables(groups: string, unresolved: string): ProjectDecision[] {
  const byId = new Map(rows(unresolved).map((row) => [row.proje_id, row]));
  const byName = new Map<string, ProjectDecision>();
  for (const row of rows(groups)) {
    const sentences = Number(row.cumle) || 0;
    let decision: ProjectDecision;
    if (!UNRESOLVED.has(row.firma)) {
      decision = {
        name: row.proje_adi,
        firm: row.firma,
        pending: false,
        decidedBy: row.neden === "proje adı" ? "name" : "text",
        sentences,
        evidence: { reason: row.neden },
      };
    } else {
      const second = byId.get(row.proje_id);
      const result = second?.sonuc ?? "genel";
      const pending = result === "?belirsiz";
      decision = {
        name: row.proje_adi,
        firm: pending || result === "genel" ? null : result,
        pending,
        decidedBy: "fingerprint",
        sentences,
        evidence: {
          reason: row.neden,
          fingerprint: second?.gerekce ?? null,
          confidence: second?.guven ?? null,
          type: second?.belge_turu ?? null,
        },
      };
    }
    const seen = byName.get(decision.name);
    if (!seen) byName.set(decision.name, decision);
    else if (seen.firm !== decision.firm || seen.pending !== decision.pending) {
      byName.set(decision.name, { ...seen, firm: null, pending: true, sentences: seen.sentences + sentences, evidence: { reason: "aynı adlı projeler farklı firmalara çıktı" } });
    } else seen.sentences += sentences;
  }
  return [...byName.values()];
}

/** Firma kayıtlarının adı ve metinde aranacak tüzel adları (spec 5.2). */
export const DEFAULT_ALIASES: Record<string, { name: string; aliases: string[] }> = {
  basf: { name: "BASF", aliases: ["BASF Agricultural Solutions", "BASF Agro", "BASF SE"] },
  syngenta: { name: "Syngenta", aliases: ["Syngenta Crop Protection", "Syngenta Tarım"] },
  nase: { name: "Nase", aliases: ["Nase İlaç", "Nase Tarım"] },
  bayer: { name: "Bayer", aliases: ["Bayer CropScience", "Bayer Türk Kimya", "Bayer AG"] },
  sqm: { name: "SQM", aliases: ["SQM Europe", "Soquimich"] },
  novozymes: { name: "Novozymes", aliases: ["Novozymes Biologicals"] },
  yara: { name: "Yara", aliases: ["Yara International"] },
  globachem: { name: "Globachem", aliases: [] },
};
```

- [ ] **Step 4: `lib/ceviri/clients.ts`**

```ts
import { getCeviriSupabase } from "./supabase";
import { fold } from "./fold";
import type { ScopeChain } from "./scope";

export type Client = {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  instructions: string | null;
  default_sector_id: string | null;
  notes: string | null;
};

const COLUMNS = "id, name, slug, aliases, instructions, default_sector_id, notes";

const ASCII: Record<string, string> = { ç: "c", ğ: "g", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

export function slugify(name: string): string {
  return fold(name)
    .replace(/[çğöşüâîû]/g, (letter) => ASCII[letter] ?? letter)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Takma adlar: virgül ya da satır sonuyla ayrılmış, tekil (büyük/küçük harf duyarsız). */
export function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const alias = part.trim();
    if (!alias || seen.has(fold(alias))) continue;
    seen.add(fold(alias));
    out.push(alias);
  }
  return out;
}

export async function listClients(): Promise<Client[]> {
  const { data, error } = await getCeviriSupabase().from("clients").select(COLUMNS).order("name");
  if (error) throw new Error(`clients okunamadı: ${error.message}`);
  return (data ?? []) as Client[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getClient(idOrSlug: string): Promise<Client | null> {
  const column = UUID.test(idOrSlug) ? "id" : "slug";
  const { data, error } = await getCeviriSupabase().from("clients").select(COLUMNS).eq(column, idOrSlug).maybeSingle();
  if (error) throw new Error(`clients okunamadı: ${error.message}`);
  return (data as Client | null) ?? null;
}

export async function createClient(input: { name: string; aliases?: string[]; defaultSectorId?: string | null }): Promise<Client> {
  const name = input.name.trim();
  if (!name) throw new Error("Firma adı gerekli.");
  const slug = slugify(name);
  if (!slug) throw new Error("Firma adı harf ya da rakam içermeli.");
  const { data, error } = await getCeviriSupabase()
    .from("clients")
    .insert({ name, slug, aliases: input.aliases ?? [], default_sector_id: input.defaultSectorId ?? null })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.code === "23505" ? `"${name}" adında bir firma zaten var.` : error.message);
  return data as Client;
}

export async function updateClient(
  id: string,
  patch: { name?: string; aliases?: string[]; instructions?: string | null; default_sector_id?: string | null },
): Promise<Client> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("Firma adı boş olamaz.");
    update.name = patch.name.trim();
  }
  if (patch.aliases !== undefined) update.aliases = patch.aliases;
  if (patch.instructions !== undefined) update.instructions = patch.instructions?.trim() || null;
  if (patch.default_sector_id !== undefined) update.default_sector_id = patch.default_sector_id;
  const { data, error } = await getCeviriSupabase().from("clients").update(update).eq("id", id).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as Client;
}

export type LibraryStats = { memory: number; terms: number; documents: number; suggestions: number };

export async function libraryStats(): Promise<Map<string, LibraryStats>> {
  const { data, error } = await getCeviriSupabase().rpc("client_library_stats");
  if (error) throw new Error(`client_library_stats failed: ${error.message}`);
  return new Map(
    ((data ?? []) as Array<Record<string, number | string>>).map((row) => [
      row.client_id as string,
      { memory: Number(row.memory), terms: Number(row.terms), documents: Number(row.documents), suggestions: Number(row.suggestions) },
    ]),
  );
}

/**
 * Belgenin kapsam zinciri ve firma talimatları. Sektör müşterinin, yoksa
 * üreticinin varsayılan sektörüdür. Talimatlar önce müşterinin, sonra
 * üreticinin.
 */
export async function scopeFor(doc: { client_id?: string | null; maker_id?: string | null }): Promise<{
  chain: ScopeChain;
  firmInstructions: string | null;
}> {
  const ids = [doc.client_id, doc.maker_id].filter((id): id is string => Boolean(id));
  if (!ids.length) return { chain: { clientId: null, makerId: null, sectorId: null }, firmInstructions: null };
  const { data, error } = await getCeviriSupabase().from("clients").select(COLUMNS).in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map(((data ?? []) as Client[]).map((client) => [client.id, client]));
  const client = doc.client_id ? byId.get(doc.client_id) ?? null : null;
  const maker = doc.maker_id ? byId.get(doc.maker_id) ?? null : null;
  const instructions = [
    client?.instructions ? `${client.name}: ${client.instructions}` : null,
    maker && maker.id !== client?.id && maker.instructions ? `${maker.name} (üretici): ${maker.instructions}` : null,
  ].filter(Boolean);
  return {
    chain: {
      clientId: client?.id ?? null,
      makerId: maker && maker.id !== client?.id ? maker.id : null,
      sectorId: client?.default_sector_id ?? maker?.default_sector_id ?? null,
    },
    firmInstructions: instructions.length ? instructions.join("\n") : null,
  };
}
```

- [ ] **Step 5: Testlerin geçtiğini gör** — `node --import tsx --test tests/ceviri-clients.test.ts` → 5 pass.

- [ ] **Step 6: `app/api/ceviri/clients/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getCeviriSupabase } from "../../../../lib/ceviri/supabase";
import { createClient, libraryStats, listClients, parseAliases } from "../../../../lib/ceviri/clients";

export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Firma listesi, kütüphane sayılarıyla; karar bekleyen proje sayısı. */
export async function GET() {
  try {
    await requireAdminSession();
    const [clients, stats, pending] = await Promise.all([
      listClients(),
      libraryStats(),
      getCeviriSupabase().from("project_clients").select("project_name", { count: "exact", head: true }).eq("pending", true),
    ]);
    const empty = { memory: 0, terms: 0, documents: 0, suggestions: 0 };
    return NextResponse.json({
      clients: clients.map((client) => ({ ...client, stats: stats.get(client.id) ?? empty })),
      pendingProjects: pending.count ?? 0,
    });
  } catch (error) {
    return failure(error, "Firmalar okunamadı.");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const body = (await request.json().catch(() => null)) as { name?: unknown; aliases?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    const aliases = typeof body?.aliases === "string" ? parseAliases(body.aliases) : [];
    const client = await createClient({ name, aliases });
    return NextResponse.json({ client });
  } catch (error) {
    return failure(error, "Firma oluşturulamadı.");
  }
}
```

- [ ] **Step 7: `app/api/ceviri/clients/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { getClient, libraryStats, parseAliases, updateClient } from "../../../../../lib/ceviri/clients";

export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Firma ayrıntısı; `id` kimlik ya da slug olabilir. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const client = await getClient(decodeURIComponent(id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const stats = (await libraryStats()).get(client.id) ?? { memory: 0, terms: 0, documents: 0, suggestions: 0 };
    return NextResponse.json({ client, stats });
  } catch (error) {
    return failure(error, "Firma okunamadı.");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const existing = await getClient(decodeURIComponent(id));
    if (!existing) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const client = await updateClient(existing.id, {
      name: typeof body?.name === "string" ? body.name : undefined,
      aliases: typeof body?.aliases === "string" ? parseAliases(body.aliases) : undefined,
      instructions: typeof body?.instructions === "string" ? body.instructions : undefined,
    });
    return NextResponse.json({ client });
  } catch (error) {
    return failure(error, "Firma kaydedilemedi.");
  }
}
```

- [ ] **Step 8: Commit** — `git add lib/ceviri/clients.ts lib/ceviri/project-firms.ts app/api/ceviri/clients tests/ceviri-clients.test.ts && git commit -m "Firma kayıtları ve proje adından firma kuralları"`

---

### Task 6: Eski arşivin dağıtılması

**Files:**
- Create: `scripts/ceviri-backfill-clients.ts`, `app/api/ceviri/projects/route.ts`
- Modify: `package.json` (script `ceviri:backfill-clients`)

**Interfaces:**
- Consumes: `readScanTables`, `DEFAULT_ALIASES` (Task 5), RPC'ler `preview_project_clients`, `apply_project_clients` (Task 1)
- Produces: `GET /api/ceviri/projects` → `{ projects: Array<{ project_name: string; evidence: Record<string, unknown> }> }`; `PATCH /api/ceviri/projects` `{ projectName: string; clientId: string | null }` → `{ saved: true, updated: Array<{ client_id: string | null; rows: number }> }`.

- [ ] **Step 1: Tarama çıktılarını proje klasörüne kopyala**

```bash
mkdir -p .claude/firma-tarama
cp "$SCRATCHPAD/firma-gruplari.tsv" "$SCRATCHPAD/belirsiz-siniflandirma.tsv" .claude/firma-tarama/
```
(`$SCRATCHPAD` = oturumun scratchpad klasörü.) `.claude/` git'te izlenmez; `git status` bunu doğrular.

- [ ] **Step 2: Betiği yaz** — `scripts/ceviri-backfill-clients.ts`

```ts
/**
 * Eski belleği firmalara dağıtır (spec 5.3).
 *
 * Usage: npm run ceviri:backfill-clients -- <firma-gruplari.tsv> <belirsiz-siniflandirma.tsv> [--apply]
 *
 * Varsayılan kuru çalışmadır: firma kayıtlarını ve proje eşlemesini yazar
 * (ikisi de geri alınabilir), bellek satırlarına dokunmadan hangi firmaya kaç
 * satır düşeceğini gösterir. `--apply` satırları günceller.
 */
import nextEnv from "@next/env";
import { readFile } from "node:fs/promises";

nextEnv.loadEnvConfig(process.cwd());

import { getCeviriSupabase } from "../lib/ceviri/supabase";
import { DEFAULT_ALIASES, readScanTables } from "../lib/ceviri/project-firms";

/** Bundan az cümlesi olan üretici için ayrı firma açılmaz; projeleri genelde kalır. */
const MIN_SENTENCES = 1000;

async function main() {
  const [groupsPath, unresolvedPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!groupsPath || !unresolvedPath) throw new Error("İki tarama tablosu gerekli (bkz. Usage).");
  const apply = process.argv.includes("--apply");
  const supabase = getCeviriSupabase();

  const decisions = readScanTables(await readFile(groupsPath, "utf8"), await readFile(unresolvedPath, "utf8"));
  const totals = new Map<string, number>();
  for (const decision of decisions) if (decision.firm) totals.set(decision.firm, (totals.get(decision.firm) ?? 0) + decision.sentences);
  const firms = [...totals].filter(([, sentences]) => sentences >= MIN_SENTENCES).map(([slug]) => slug);
  console.log("Firmalar:", [...totals].map(([slug, n]) => `${slug}=${n}${firms.includes(slug) ? "" : " (genel)"}`).join(", "));

  const { data: sector } = await supabase.from("sectors").select("id").eq("slug", "zirai-ilac").maybeSingle();
  const ids = new Map<string, string>();
  for (const slug of firms) {
    const preset = DEFAULT_ALIASES[slug] ?? { name: slug, aliases: [] };
    const { data: existing } = await supabase.from("clients").select("id, aliases").eq("slug", slug).maybeSingle();
    if (existing) {
      const aliases = [...new Set([...(existing.aliases as string[]), ...preset.aliases])];
      await supabase.from("clients").update({ aliases, default_sector_id: sector?.id ?? null }).eq("id", existing.id);
      ids.set(slug, existing.id as string);
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert({ slug, name: preset.name, aliases: preset.aliases, default_sector_id: sector?.id ?? null })
        .select("id")
        .single();
      if (error) throw new Error(`${slug} oluşturulamadı: ${error.message}`);
      ids.set(slug, data.id as string);
    }
  }

  const rows = decisions.map((decision) => ({
    project_name: decision.name,
    client_id: decision.firm && ids.has(decision.firm) ? ids.get(decision.firm)! : null,
    decided_by: decision.decidedBy,
    pending: decision.pending,
    evidence: { ...decision.evidence, sentences: decision.sentences, firm: decision.firm },
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("project_clients").upsert(rows.slice(i, i + 500), { onConflict: "project_name" });
    if (error) throw new Error(`project_clients yazılamadı: ${error.message}`);
  }
  console.log(`${rows.length} proje eşlendi; ${rows.filter((r) => r.pending).length} karar bekliyor.`);

  const { data, error } = await supabase.rpc(apply ? "apply_project_clients" : "preview_project_clients");
  if (error) throw new Error(error.message);
  const names = new Map([...ids].map(([slug, id]) => [id, slug]));
  console.log(apply ? "Güncellenen satırlar:" : "Kuru çalışma — düşecek satırlar:");
  for (const row of (data ?? []) as Array<{ client_id: string | null; rows: number }>) {
    console.log(`  ${row.client_id ? names.get(row.client_id) ?? row.client_id : "genel"}: ${row.rows}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

`package.json` scripts'e: `"ceviri:backfill-clients": "tsx scripts/ceviri-backfill-clients.ts"`.

- [ ] **Step 3: Kuru çalıştır ve oku**

Run: `npm run ceviri:backfill-clients -- .claude/firma-tarama/firma-gruplari.tsv .claude/firma-tarama/belirsiz-siniflandirma.tsv`
Expected: firma listesi (syngenta, nase, bayer, basf, sqm, novozymes, yara, globachem ≥ 1000; diğerleri "(genel)"), ~742 proje eşlendi, 18 civarı bekliyor; satır dağılımı. Syngenta + Nase + Bayer + BASF satırları, toplam satırın (73.623) makul bir payı olmalı; genel pay en büyük tek grup olabilir (paylaşılan ve kişisel belge satırları).

- [ ] **Step 4: Uygula** — `npm run ceviri:backfill-clients -- <aynı iki yol> --apply`; ardından `execute_sql`: `select * from client_library_stats();` — firmaların `memory` değerleri kuru çalışmadakiyle aynı.

- [ ] **Step 5: `app/api/ceviri/projects/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getCeviriSupabase } from "../../../../lib/ceviri/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Eski arşivde firması kesinleşmemiş projeler: iki firma izi ya da çok zayıf iz. */
export async function GET() {
  try {
    await requireAdminSession();
    const { data, error } = await getCeviriSupabase()
      .from("project_clients")
      .select("project_name, evidence")
      .eq("pending", true)
      .order("project_name");
    if (error) throw new Error(error.message);
    return NextResponse.json({ projects: data ?? [] });
  } catch (error) {
    return failure(error, "Projeler okunamadı.");
  }
}

/** Kullanıcının kararı: proje bir firmaya (ya da genele) bağlanır, satırlar yeniden dağıtılır. */
export async function PATCH(request: Request) {
  try {
    await requireAdminSession();
    const body = (await request.json().catch(() => null)) as { projectName?: unknown; clientId?: unknown } | null;
    const projectName = typeof body?.projectName === "string" ? body.projectName : "";
    const clientId = typeof body?.clientId === "string" && body.clientId ? body.clientId : null;
    if (!projectName) return NextResponse.json({ error: "projectName gerekli." }, { status: 400 });
    const supabase = getCeviriSupabase();
    const { error } = await supabase
      .from("project_clients")
      .update({ client_id: clientId, pending: false, decided_by: "user" })
      .eq("project_name", projectName);
    if (error) throw new Error(error.message);
    const { data, error: applyError } = await supabase.rpc("apply_project_clients");
    if (applyError) throw new Error(applyError.message);
    return NextResponse.json({ saved: true, updated: data ?? [] });
  } catch (error) {
    return failure(error, "Karar kaydedilemedi.");
  }
}
```

- [ ] **Step 6: Commit** — `git add scripts/ceviri-backfill-clients.ts app/api/ceviri/projects package.json && git commit -m "Eski belleği proje adı ve parmak iziyle firmalara dağıtma"`

---

### Task 7: Belgede firma: yükleme, değiştirme, zincirli çeviri

**Files:**
- Modify: `app/api/ceviri/documents/route.ts`, `app/api/ceviri/documents/[id]/route.ts`, `app/api/ceviri/documents/[id]/translate/route.ts`, `lib/ceviri/library.ts`

**Interfaces:**
- Consumes: `scopeFor` (Task 5), `translateSegment(..., { scope, firmInstructions })` (Task 4)
- Produces: yükleme formu `clientId` = `auto` | `none` | uuid (Faz 3'e kadar `auto` = `none` gibi davranır, tespit Task 14'te bağlanır); belge JSON'unda `client_id`, `maker_id`, `detection`; `PATCH /api/ceviri/documents/[id]` `{ clientId: string | null, makerId?: string | null, retranslate?: boolean }` → `{ document }`; `GET /api/ceviri/documents?client=<uuid>` süzgeci; saklanan segmentlerde `terms?: Array<{ sourceText: string; targetText: string }>` (Task 17 kullanır).

- [ ] **Step 1: Yükleme** — `app/api/ceviri/documents/route.ts` `POST` içinde `targetLang` satırından sonra:

```ts
    // Firma: "auto" (tespit edilir), "none" (genel) ya da firmanın kimliği.
    const clientChoice = String(form.get("clientId") ?? "auto");
```
insert'ten önce:

```ts
    let clientId: string | null = null;
    let makerId: string | null = null;
    let detection: Record<string, unknown> | null = null;
    if (clientChoice !== "auto" && clientChoice !== "none") {
      clientId = clientChoice;
      detection = { decision: "manual", clientId, makerId: null, candidates: [], at: new Date().toISOString() };
    }
```
insert nesnesine `client_id: clientId, maker_id: makerId, detection,` ekle; `.select(...)` listesine `client_id, maker_id, detection` ekle.

- [ ] **Step 2: Kütüphane süzgeci** — aynı dosyanın `GET`'inde `.range(...)` satırından sonra:

```ts
    const client = params.get("client");
    if (client) select = client === "none" ? select.is("client_id", null) : select.eq("client_id", client);
```
ve `select(...)` sütunlarına `client_id` ekle. `lib/ceviri/library.ts` `LibraryItem`'a `clientId: string | null;` ekle ve `toLibraryItem` içinde `clientId: (row.client_id as string | null) ?? null` doldur.

- [ ] **Step 3: Belge ayrıntısı ve değiştirme** — `app/api/ceviri/documents/[id]/route.ts`: `GET` select'ine `client_id, maker_id, detection` ekle. Aynı dosyaya:

```ts
/**
 * Belgenin firmasını değiştirir. `retranslate` ise çevirmenin düzeltmediği
 * bütün satırlar yeniden çevrilmek üzere boşaltılır: yeni firmanın terimcesi
 * ve belleği uygulansın. Düzeltilmiş satırlar olduğu gibi kalır.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { clientId?: unknown; makerId?: unknown; retranslate?: unknown } | null;
    if (!body || !("clientId" in body)) return NextResponse.json({ error: "clientId gerekli." }, { status: 400 });
    const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
    const supabase = getCeviriSupabase();
    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("id, segments, maker_id, detection")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const makerId =
      "makerId" in body
        ? typeof body.makerId === "string" && body.makerId ? body.makerId : null
        : doc.maker_id === clientId ? null : (doc.maker_id as string | null);
    const previous = (doc.detection as Record<string, unknown> | null) ?? {};
    const update: Record<string, unknown> = {
      client_id: clientId,
      maker_id: makerId,
      detection: { ...previous, decision: "manual", clientId, makerId, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
    if (body.retranslate === true) {
      update.segments = (doc.segments as Array<Record<string, unknown>>).map((segment) =>
        segment.source === "human"
          ? segment
          : { ...segment, translation: null, source: null, score: null, engine: null, alternatives: [], note: null, warning: null, terms: [] },
      );
      update.status = "parsed";
    }
    const { data, error: saveError } = await supabase
      .from("ceviri_documents")
      .update(update)
      .eq("id", id)
      .select("id, filename, stats, segments, source_lang, target_lang, status, instructions, chat, client_id, maker_id, detection")
      .single();
    if (saveError) throw new Error(saveError.message);
    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kaydedilemedi." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Zincirli çeviri** — `app/api/ceviri/documents/[id]/translate/route.ts`: import `import { scopeFor } from "../../../../../../lib/ceviri/clients";`. Select'e `client_id, maker_id` ekle. `model` satırından sonra:

```ts
    // Firmanın terimcesi ve belleği önce: müşteri → üretici → sektör → genel.
    const { chain, firmInstructions } = await scopeFor(doc as { client_id?: string | null; maker_id?: string | null });
```
`translateSegment` seçeneklerine `scope: chain, firmInstructions,` ekle. `merged` içinde segmente `terms: result.terms.map(({ sourceText, targetText }) => ({ sourceText, targetText })),` ekle; `StoredSegment` tipine `terms?: Array<{ sourceText: string; targetText: string }>;` ekle.

- [ ] **Step 5: Derleme ve testler** — `npx tsc --noEmit -p . 2>&1 | grep -E "lib/ceviri|app/api/ceviri|app/ceviri-app"` → çıktı boş; `node --import tsx --test tests/ceviri-*.test.ts` → hepsi pass (`tests/ceviri-library.test.ts` `clientId` alanı eklendiği için beklenen nesneyi güncellemek gerekirse güncellenir).

- [ ] **Step 6: Commit** — `git commit -am "Belgede firma: yüklemede seçim, değiştirip yeniden çevirme, zincirli çeviri"`

---

### Task 8: Arayüz — firma seçici, belge rozeti, Firmalar sayfası

**Files:**
- Create: `app/ceviri-app/firm-picker.tsx`, `app/ceviri-app/firms.module.css`, `app/ceviri-app/firmalar/page.tsx`, `app/ceviri-app/firmalar/firms.tsx`
- Modify: `app/ceviri-app/lingua.tsx`, `app/ceviri-app/lingua.module.css`

**Interfaces:**
- Consumes: `GET /api/ceviri/clients`, `POST /api/ceviri/clients`, `GET/PATCH /api/ceviri/projects`, `PATCH /api/ceviri/documents/[id]`, `POST /api/ceviri/clients/signatures` (Task 13; buton o göreve kadar 404 verirse hata mesajı gösterir)
- Produces: `FirmPicker({ value, onChange, clients, disabled?, allowAuto?, label? })`, `type ClientOption = { id: string; name: string; slug: string }`.

- [ ] **Step 1: `firm-picker.tsx`**

```tsx
"use client";

import styles from "./lingua.module.css";

export type ClientOption = { id: string; name: string; slug: string };

/**
 * Firma seçici. "Otomatik": sistem belgeyi okuyup firmayı tahmin eder;
 * "Genel": firmasız, yalnızca genel terimce ve bellek.
 */
export default function FirmPicker({
  value,
  onChange,
  clients,
  disabled = false,
  allowAuto = true,
  label = "Firma",
}: {
  value: string;
  onChange: (value: string) => void;
  clients: ClientOption[];
  disabled?: boolean;
  allowAuto?: boolean;
  label?: string;
}) {
  return (
    <label className={styles.firm} title="Çeviri bu firmanın terimcesi ve belleğiyle yapılır">
      <span className={styles.firmLabel}>{label}</span>
      <select className={styles.firmSelect} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {allowAuto && <option value="auto">Otomatik</option>}
        <option value="none">Genel</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: `lingua.module.css` sonuna**

```css
/* ---------- firma ---------- */

.firm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--ink-soft);
  background: var(--surface);
}
.firmLabel { font-weight: 500; }
.firmSelect {
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 600;
  color: var(--ink);
  padding: 4px 4px;
  outline: none;
  cursor: pointer;
}
.firmSelect:disabled { cursor: default; color: var(--ink-soft); }
.firmLine {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 10px 0 2px;
  font-size: 13.5px;
  color: var(--ink);
}
.firmWhy { font-size: 12px; color: var(--ink-mute); }
.firmAsk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 14px;
  background: #fff8e6;
  color: #7a5200;
  font-size: 13.5px;
}
```

- [ ] **Step 3: `lingua.tsx`** — değişiklikler:

1. Import: `import FirmPicker, { type ClientOption } from "./firm-picker";`
2. Tipler (dosyanın başındaki `Doc`'tan önce):

```tsx
type Detection = {
  decision: "auto" | "suggest" | "ask" | "manual";
  clientId: string | null;
  makerId: string | null;
  candidates?: Array<{ clientId: string; score: number; reasons: string[] }>;
};
```
`Doc`'a: `client_id?: string | null; maker_id?: string | null; detection?: Detection | null;`

3. State: `const [clients, setClients] = useState<ClientOption[]>([]);` ve `const [firm, setFirm] = useState("auto");`
4. Açılış effect'inin yanına:

```tsx
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/ceviri/clients");
        const payload = await res.json();
        if (res.ok) setClients(payload.clients as ClientOption[]);
      } catch {
        setClients([]);
      }
    })();
  }, []);
```
5. `upload` içinde `form.append("targetLang", targetLang);` ardından `form.append("clientId", firm);` ve bağımlılıklara `firm`.
6. Yardımcılar (`translate` fonksiyonundan sonra):

```tsx
  const clientName = (id: string | null | undefined) => clients.find((client) => client.id === id)?.name ?? null;

  /** Firmayı değiştirir; çevrilmiş satırlar varsa yeni firmaya göre yeniden çevirmeyi önerir. */
  async function changeFirm(current: Doc, value: string) {
    const clientId = value === "none" ? null : value;
    const translatedByMachine = current.segments.some((s) => s.translation !== null && s.source !== "human");
    const retranslate =
      translatedByMachine &&
      window.confirm("Firma değişti. Çevrilmiş satırlar bu firmanın terimcesi ve belleğiyle yeniden çevrilsin mi? (Düzelttikleriniz korunur.)");
    setError(null);
    try {
      const res = await fetch(`/api/ceviri/documents/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, retranslate }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Firma değiştirilemedi.");
      const updated = { ...current, ...(payload.document as Doc) };
      setDoc(updated);
      if (retranslate) await translate(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firma değiştirilemedi.");
    }
  }
```
7. Belge karşılamasında, `botText` paragrafının hemen altına:

```tsx
                  {doc.detection?.decision === "ask" ? (
                    <div className={styles.firmAsk}>
                      <b>Bu belgenin firmasını tanıyamadım.</b>
                      <span>Çeviriden önce seçin — terimce ve bellek buna göre kullanılır.</span>
                      <FirmPicker
                        allowAuto={false}
                        value="none"
                        label="Firma"
                        clients={clients}
                        disabled={working}
                        onChange={(value) => void changeFirm(doc, value)}
                      />
                      <button className={styles.secondary} type="button" disabled={working} onClick={() => void changeFirm(doc, "none")}>
                        Genel ile devam
                      </button>
                    </div>
                  ) : (
                    <div className={styles.firmLine}>
                      <span>
                        Firma: <b>{clientName(doc.client_id) ?? "Genel"}</b>
                        {doc.maker_id && <> · Üretici: <b>{clientName(doc.maker_id) ?? "—"}</b></>}
                      </span>
                      {doc.detection && doc.detection.decision !== "manual" && (
                        <span className={styles.firmWhy}>
                          {doc.detection.decision === "auto" ? "otomatik" : "tahmin — kontrol edin"}
                          {doc.detection.candidates?.[0]?.reasons.length ? `: ${doc.detection.candidates[0].reasons.join(" · ")}` : ""}
                        </span>
                      )}
                      <FirmPicker
                        allowAuto={false}
                        value={doc.client_id ?? "none"}
                        label="Değiştir"
                        clients={clients}
                        disabled={working}
                        onChange={(value) => void changeFirm(doc, value)}
                      />
                    </div>
                  )}
```
8. "Çeviriyi başlat" butonunun `disabled`'ı: `disabled={working || doc.detection?.decision === "ask"}`.
9. Besteci çubuğunda `LanguagePicker`'ların bulunduğu `div`'den sonra: `<FirmPicker value={firm} onChange={setFirm} clients={clients} disabled={doc !== null} />`
10. Üst şeritte `Kütüphane` bağlantısından önce: `<Link className={styles.topLink} href="/ceviri-app/firmalar">Firmalar</Link>`

- [ ] **Step 4: `firms.module.css`**

```css
.page { flex: 1; overflow-y: auto; }
.inner { max-width: 1080px; margin: 0 auto; padding: 10px 22px 60px; }
.head { display: flex; align-items: flex-end; gap: 14px; margin: 18px 0 20px; }
.title { font-size: 28px; font-weight: 600; letter-spacing: -.02em; margin: 0; }
.sub { color: var(--ink-soft); font-size: 14px; margin: 4px 0 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.card {
  display: block; padding: 16px 18px; border-radius: 18px; background: var(--surface);
  box-shadow: var(--lift); color: inherit; text-decoration: none; transition: transform .15s;
}
.card:hover { transform: translateY(-2px); }
.cardName { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
.nums { display: flex; gap: 14px; font-size: 12.5px; color: var(--ink-soft); flex-wrap: wrap; }
.nums b { color: var(--ink); font-weight: 600; }
.section { margin-top: 30px; }
.sectionHead { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.sectionTitle { font-size: 16px; font-weight: 600; margin: 0; }
.muted { color: var(--ink-mute); font-size: 12.5px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 0; border-top: 1px solid var(--line-soft); font-size: 13.5px; }
.grow { flex: 1; min-width: 200px; }
.input, .textarea, .select {
  font: inherit; font-size: 13.5px; border: 1px solid var(--line); border-radius: 10px;
  padding: 8px 10px; background: var(--surface); color: var(--ink); outline: none;
}
.input:focus, .textarea:focus, .select:focus { border-color: #c9c9d2; }
.textarea { width: 100%; min-height: 90px; resize: vertical; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 18px; }
.tab { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 7px 13px; font: inherit; font-size: 13px; cursor: pointer; color: var(--ink-soft); }
.tabOn { background: var(--ink); color: #fff; border-color: var(--ink); }
.badge { display: inline-block; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; background: var(--line-soft); color: var(--ink-soft); }
.badgeRed { background: #fdf1f1; color: #ad2b31; }
.badgeGreen { background: #eef8f1; color: #1d6b3a; }
.panel { padding: 16px 18px; border-radius: 18px; background: var(--surface); box-shadow: var(--lift); margin-bottom: 14px; }
.panelTitle { font-weight: 600; font-size: 14px; margin: 0 0 6px; }
.ok { color: #1d6b3a; font-size: 13px; }
```

- [ ] **Step 5: `firmalar/page.tsx`**

```tsx
import Firms from "./firms";

export const metadata = { title: "Firmalar | Lingua" };

export default function FirmsPage() {
  return <Firms />;
}
```

- [ ] **Step 6: `firmalar/firms.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../lingua.module.css";
import firms from "../firms.module.css";

type Stats = { memory: number; terms: number; documents: number; suggestions: number };
type Firm = { id: string; name: string; slug: string; aliases: string[]; stats: Stats };
type PendingProject = { project_name: string; evidence: { sentences?: number; reason?: string; fingerprint?: string | null; confidence?: string | null; type?: string | null } };

const number = (value: number) => value.toLocaleString("tr-TR");

export default function Firms() {
  const [list, setList] = useState<Firm[] | null>(null);
  const [pending, setPending] = useState<PendingProject[]>([]);
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [clientsRes, projectsRes] = await Promise.all([fetch("/api/ceviri/clients"), fetch("/api/ceviri/projects")]);
      const clients = await clientsRes.json();
      const projects = await projectsRes.json();
      if (!clientsRes.ok) throw new Error(clients.error ?? "Firmalar okunamadı.");
      setList(clients.clients as Firm[]);
      if (projectsRes.ok) setPending(projects.projects as PendingProject[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firmalar okunamadı.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ceviri/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Firma oluşturulamadı.");
      setName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firma oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(projectName: string) {
    const value = choice[projectName] ?? "none";
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ceviri/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, clientId: value === "none" ? null : value }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Karar kaydedilemedi.");
      setMessage(`"${projectName}" kaydedildi.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Karar kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    setBusy(true);
    setError(null);
    setMessage("Parmak izi yeniden kuruluyor… (bir dakika sürebilir)");
    try {
      const res = await fetch("/api/ceviri/clients/signatures", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Parmak izi kurulamadı.");
      setMessage(`Parmak izi kuruldu: ${number(payload.signatures)} özgü ifade, ${number(payload.documents)} belge/proje tarandı.`);
    } catch (cause) {
      setMessage(null);
      setError(cause instanceof Error ? cause.message : "Parmak izi kurulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.app} lang="tr">
      <div className={styles.top}>
        <Link className={styles.mark} href="/ceviri-app">
          <span className={styles.markDot} />
          Lingua
        </Link>
        <span className={styles.topSpacer} />
        <Link className={styles.topLink} href="/ceviri-app">Çeviri</Link>
        <Link className={styles.topLink} href="/ceviri-app/kutuphane">Kütüphane</Link>
        <Link className={styles.topLink} href="/ceviri-app/bellek">Bellek</Link>
      </div>
      <div className={firms.page}>
        <div className={firms.inner}>
          <div className={firms.head}>
            <div style={{ flex: 1 }}>
              <h1 className={firms.title}>Firmalar</h1>
              <p className={firms.sub}>
                Her firmanın kendi terimcesi, belleği ve referans çevirileri. Belge yüklenirken firma seçilir ya
                da otomatik tanınır; çeviri önce o firmanın kütüphanesine bakar.
              </p>
            </div>
            <button className={styles.secondary} type="button" onClick={() => void rebuild()} disabled={busy}>
              Parmak izini yenile
            </button>
          </div>

          {error && <div className={styles.err}>{error}</div>}
          {message && <p className={firms.ok}>{message}</p>}

          <div className={firms.grid}>
            {list?.map((firm) => (
              <Link key={firm.id} className={firms.card} href={`/ceviri-app/firmalar/${firm.slug}`}>
                <div className={firms.cardName}>{firm.name}</div>
                <div className={firms.nums}>
                  <span><b>{number(firm.stats.memory)}</b> cümle</span>
                  <span><b>{number(firm.stats.terms)}</b> terim</span>
                  <span><b>{number(firm.stats.documents)}</b> belge</span>
                  {firm.stats.suggestions > 0 && <span className={`${firms.badge} ${firms.badgeGreen}`}>{firm.stats.suggestions} öneri</span>}
                </div>
              </Link>
            ))}
            <div className={firms.card}>
              <div className={firms.cardName}>Yeni firma</div>
              <div className={firms.row} style={{ borderTop: 0, padding: 0 }}>
                <input
                  className={`${firms.input} ${firms.grow}`}
                  placeholder="Firma adı"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void create()}
                />
                <button className={styles.primary} type="button" onClick={() => void create()} disabled={busy || !name.trim()}>
                  Ekle
                </button>
              </div>
            </div>
          </div>

          {pending.length > 0 && (
            <div className={firms.section}>
              <div className={firms.sectionHead}>
                <h2 className={firms.sectionTitle}>Karar bekleyen projeler</h2>
                <span className={firms.muted}>
                  Eski bellekte iki firmanın izi taşıyan ya da izi çok zayıf projeler. Seçtiğiniz firmaya bağlanır.
                </span>
              </div>
              <div className={firms.panel}>
                {pending.map((project) => (
                  <div className={firms.row} key={project.project_name}>
                    <div className={firms.grow}>
                      <b>{project.project_name}</b>
                      <div className={firms.muted}>
                        {project.evidence.sentences ? `${number(project.evidence.sentences)} cümle · ` : ""}
                        {project.evidence.confidence || project.evidence.reason}
                        {project.evidence.type ? ` · ${project.evidence.type}` : ""}
                      </div>
                    </div>
                    <select
                      className={firms.select}
                      value={choice[project.project_name] ?? "none"}
                      onChange={(event) => setChoice({ ...choice, [project.project_name]: event.target.value })}
                    >
                      <option value="none">Genel</option>
                      {list?.map((firm) => (
                        <option key={firm.id} value={firm.id}>{firm.name}</option>
                      ))}
                    </select>
                    <button className={styles.secondary} type="button" disabled={busy} onClick={() => void decide(project.project_name)}>
                      Kaydet
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Doğrula** — `npx tsc --noEmit -p . 2>&1 | grep -E "app/ceviri-app"` boş; `npx eslint app/ceviri-app` temiz; yerel sunucuda `/ceviri-app/firmalar` açılır, firmalar ve karar bekleyen projeler görünür; ana sayfada firma seçici görünür.

- [ ] **Step 8: Commit** — `git add app/ceviri-app && git commit -m "Arayüz: firma seçici, belge firma rozeti, Firmalar sayfası"`

---

## FAZ 2 — Kütüphaneye yükleme

### Task 9: Firma sayfası, ayarlar ve terimce

**Files:**
- Create: `app/api/ceviri/clients/[id]/terms/route.ts`, `app/ceviri-app/firmalar/[slug]/page.tsx`, `app/ceviri-app/firmalar/[slug]/firm.tsx`

**Interfaces:**
- Consumes: `getClient`, `updateClient` (Task 5); `normalizeForMatch` (`lib/ceviri/normalize.ts`)
- Produces: `GET /api/ceviri/clients/[id]/terms?q=` → `{ terms: Array<{ id: string; variants: Array<{ lang: string; text: string; is_forbidden: boolean }> }> }`; `POST` `{ sourceLang, sourceText, targetLang, targetText, forbidden? }` → `{ id }`; `DELETE ?conceptId=` → `{ deleted: true }`. `firm.tsx` sekmeleri: `ayarlar | terimce | yukle | oneriler | belgeler` — `yukle` ve `oneriler` içerikleri Task 10, 12, 16'da doldurulur; bu görevde "yakında" yerine boş olmayan bir iskelet: sekme başlıkları ve Task 10/12/16'nın bileşen yerleri (`<UploadTab client={client} />`, `<SuggestionsTab client={client} />`) aynı dosyada tanımlanır.

- [ ] **Step 1: Terimce API'si** — `app/api/ceviri/clients/[id]/terms/route.ts`

```ts
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { getClient } from "../../../../../../lib/ceviri/clients";
import { normalizeForMatch } from "../../../../../../lib/ceviri/normalize";

export const runtime = "nodejs";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

async function clientOr404(id: string) {
  const client = await getClient(decodeURIComponent(id));
  return client;
}

/** Firmanın terimleri, en yeniden eskiye; `q` kaynak ya da hedef metinde arar. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await clientOr404((await context.params).id);
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const q = new URL(request.url).searchParams.get("q")?.trim().toLocaleLowerCase("tr") ?? "";
    const { data, error } = await getCeviriSupabase()
      .from("term_concepts")
      .select("id, created_at, term_variants(lang, text, is_forbidden)")
      .eq("scope_type", "client")
      .eq("scope_id", client.id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const terms = ((data ?? []) as Array<{ id: string; term_variants: Array<{ lang: string; text: string; is_forbidden: boolean }> }>)
      .map((row) => ({ id: row.id, variants: row.term_variants }))
      .filter((term) => !q || term.variants.some((v) => v.text.toLocaleLowerCase("tr").includes(q)));
    return NextResponse.json({ terms });
  } catch (error) {
    return failure(error, "Terimler okunamadı.");
  }
}

/** Elle terim: kaynak ve hedef karşılık; `forbidden` ise hedef yasaklı karşılıktır. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await clientOr404((await context.params).id);
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const sourceLang = String(body?.sourceLang ?? "en-US");
    const targetLang = String(body?.targetLang ?? "tr-TR");
    const sourceText = String(body?.sourceText ?? "").trim();
    const targetText = String(body?.targetText ?? "").trim();
    const forbidden = body?.forbidden === true;
    if (!sourceText || !targetText) return NextResponse.json({ error: "Kaynak ve hedef terim gerekli." }, { status: 400 });

    const supabase = getCeviriSupabase();
    const { data: concept, error } = await supabase
      .from("term_concepts")
      .insert({ scope_type: "client", scope_id: client.id })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const variants = [
      { concept_id: concept.id, lang: sourceLang, text: sourceText, normalized: normalizeForMatch(sourceText, sourceLang), is_preferred: true, is_forbidden: false },
      { concept_id: concept.id, lang: targetLang, text: targetText, normalized: normalizeForMatch(targetText, targetLang), is_preferred: !forbidden, is_forbidden: forbidden },
    ];
    const { error: variantError } = await supabase.from("term_variants").insert(variants);
    if (variantError) {
      await supabase.from("term_concepts").delete().eq("id", concept.id);
      throw new Error(variantError.message);
    }
    return NextResponse.json({ id: concept.id });
  } catch (error) {
    return failure(error, "Terim eklenemedi.");
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await clientOr404((await context.params).id);
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const conceptId = new URL(request.url).searchParams.get("conceptId") ?? "";
    const { error } = await getCeviriSupabase()
      .from("term_concepts")
      .delete()
      .eq("id", conceptId)
      .eq("scope_type", "client")
      .eq("scope_id", client.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return failure(error, "Terim silinemedi.");
  }
}
```

- [ ] **Step 2: `firmalar/[slug]/page.tsx`**

```tsx
import Firm from "./firm";

export const metadata = { title: "Firma | Lingua" };

export default async function FirmPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Firm slug={decodeURIComponent(slug)} />;
}
```

- [ ] **Step 3: `firmalar/[slug]/firm.tsx`** — üst şerit Firms ile aynı; yükleme `GET /api/ceviri/clients/<slug>`; sekmeler:

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../../lingua.module.css";
import firms from "../../firms.module.css";

export type FirmClient = { id: string; name: string; slug: string; aliases: string[]; instructions: string | null };
type Stats = { memory: number; terms: number; documents: number; suggestions: number };
type Term = { id: string; variants: Array<{ lang: string; text: string; is_forbidden: boolean }> };
type Tab = "terimce" | "yukle" | "oneriler" | "belgeler" | "ayarlar";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "terimce", label: "Terimce" },
  { id: "yukle", label: "Kütüphaneye yükle" },
  { id: "oneriler", label: "Öneriler" },
  { id: "belgeler", label: "Belgeler" },
  { id: "ayarlar", label: "Ayarlar" },
];

export const LANGS = ["en-US", "en-GB", "tr-TR", "de-DE", "fr-FR", "es-ES", "it-IT", "ru-RU", "el-GR", "pl-PL"];
const number = (value: number) => value.toLocaleString("tr-TR");

export async function readJson(res: Response, fallback: string) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? fallback);
  return payload;
}

function TermsTab({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ sourceLang: "en-US", sourceText: "", targetLang: "tr-TR", targetText: "", forbidden: false });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await readJson(await fetch(`/api/ceviri/clients/${client.id}/terms?q=${encodeURIComponent(q)}`), "Terimler okunamadı.");
      setTerms(payload.terms as Term[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terimler okunamadı.");
    }
  }, [client.id, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setError(null);
    try {
      await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/terms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }),
        "Terim eklenemedi.",
      );
      setForm({ ...form, sourceText: "", targetText: "", forbidden: false });
      await load();
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terim eklenemedi.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Bu terim firmanın terimcesinden silinsin mi?")) return;
    try {
      await readJson(await fetch(`/api/ceviri/clients/${client.id}/terms?conceptId=${id}`, { method: "DELETE" }), "Terim silinemedi.");
      await load();
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terim silinemedi.");
    }
  }

  return (
    <>
      <div className={firms.panel}>
        <p className={firms.panelTitle}>Terim ekle</p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <select className={firms.select} value={form.sourceLang} onChange={(e) => setForm({ ...form, sourceLang: e.target.value })}>
            {LANGS.map((lang) => <option key={lang}>{lang}</option>)}
          </select>
          <input className={`${firms.input} ${firms.grow}`} placeholder="Kaynak terim (ör. registration)" value={form.sourceText} onChange={(e) => setForm({ ...form, sourceText: e.target.value })} />
          <select className={firms.select} value={form.targetLang} onChange={(e) => setForm({ ...form, targetLang: e.target.value })}>
            {LANGS.map((lang) => <option key={lang}>{lang}</option>)}
          </select>
          <input className={`${firms.input} ${firms.grow}`} placeholder="Firmanın karşılığı (ör. ruhsat)" value={form.targetText} onChange={(e) => setForm({ ...form, targetText: e.target.value })} />
          <label className={firms.muted}>
            <input type="checkbox" checked={form.forbidden} onChange={(e) => setForm({ ...form, forbidden: e.target.checked })} /> yasaklı karşılık
          </label>
          <button className={styles.primary} type="button" onClick={() => void add()} disabled={!form.sourceText.trim() || !form.targetText.trim()}>
            Ekle
          </button>
        </div>
      </div>
      {error && <div className={styles.err}>{error}</div>}
      <div className={firms.panel}>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <input className={`${firms.input} ${firms.grow}`} placeholder="Terimcede ara" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className={firms.muted}>{terms ? `${terms.length} terim` : "yükleniyor…"}</span>
        </div>
        {terms?.map((term) => (
          <div className={firms.row} key={term.id}>
            <div className={firms.grow}>
              {term.variants.map((variant) => (
                <span key={`${variant.lang}-${variant.text}`} style={{ marginRight: 14 }}>
                  <span className={firms.muted}>{variant.lang}</span> <b>{variant.text}</b>
                  {variant.is_forbidden && <> <span className={`${firms.badge} ${firms.badgeRed}`}>YASAKLI</span></>}
                </span>
              ))}
            </div>
            <button className={styles.secondary} type="button" onClick={() => void remove(term.id)}>Sil</button>
          </div>
        ))}
      </div>
    </>
  );
}

function SettingsTab({ client, onSaved }: { client: FirmClient; onSaved: (client: FirmClient) => void }) {
  const [name, setName] = useState(client.name);
  const [aliases, setAliases] = useState(client.aliases.join(", "));
  const [instructions, setInstructions] = useState(client.instructions ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const payload = await readJson(
        await fetch(`/api/ceviri/clients/${client.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, aliases, instructions }),
        }),
        "Kaydedilemedi.",
      );
      onSaved(payload.client as FirmClient);
      setMessage("Kaydedildi.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kaydedilemedi.");
    }
  }

  return (
    <div className={firms.panel}>
      <p className={firms.panelTitle}>Ad</p>
      <input className={firms.input} value={name} onChange={(e) => setName(e.target.value)} />
      <p className={firms.panelTitle} style={{ marginTop: 16 }}>Tüzel adlar ve takma adlar</p>
      <p className={firms.muted}>Belgede bunlardan biri geçerse firma tanınır. Virgülle ayırın (ör. Bayer CropScience, Bayer Türk Kimya).</p>
      <textarea className={firms.textarea} value={aliases} onChange={(e) => setAliases(e.target.value)} />
      <p className={firms.panelTitle} style={{ marginTop: 16 }}>Firma talimatları</p>
      <p className={firms.muted}>Bu firmanın her belgesinde uygulanır (ör. &quot;Adresler çevrilmez&quot;, &quot;Registration her zaman ruhsat&quot;).</p>
      <textarea className={firms.textarea} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      <div className={firms.row} style={{ borderTop: 0 }}>
        <button className={styles.primary} type="button" onClick={() => void save()}>Kaydet</button>
        {message && <span className={firms.ok}>{message}</span>}
        {error && <span className={styles.err}>{error}</span>}
      </div>
    </div>
  );
}

function DocumentsTab({ client }: { client: FirmClient }) {
  const [docs, setDocs] = useState<Array<{ id: string; filename: string; created_at: string }> | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/ceviri/documents?client=${client.id}&limit=60`);
      const payload = await res.json().catch(() => ({ documents: [] }));
      setDocs(res.ok ? payload.documents : []);
    })();
  }, [client.id]);
  return (
    <div className={firms.panel}>
      {docs === null && <span className={firms.muted}>yükleniyor…</span>}
      {docs?.length === 0 && <span className={firms.muted}>Bu firmayla çevrilmiş belge yok.</span>}
      {docs?.map((doc) => (
        <div className={firms.row} key={doc.id}>
          <Link className={firms.grow} href={`/ceviri-app?belge=${doc.id}`}>{doc.filename}</Link>
          <span className={firms.muted}>{new Date(doc.created_at).toLocaleDateString("tr-TR")}</span>
        </div>
      ))}
    </div>
  );
}

export default function Firm({ slug }: { slug: string }) {
  const [client, setClient] = useState<FirmClient | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<Tab>("terimce");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await readJson(await fetch(`/api/ceviri/clients/${encodeURIComponent(slug)}`), "Firma okunamadı.");
      setClient(payload.client as FirmClient);
      setStats(payload.stats as Stats);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firma okunamadı.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.app} lang="tr">
      <div className={styles.top}>
        <Link className={styles.mark} href="/ceviri-app">
          <span className={styles.markDot} />
          Lingua
        </Link>
        <span className={styles.topSpacer} />
        <Link className={styles.topLink} href="/ceviri-app/firmalar">Firmalar</Link>
        <Link className={styles.topLink} href="/ceviri-app">Çeviri</Link>
      </div>
      <div className={firms.page}>
        <div className={firms.inner}>
          {error && <div className={styles.err}>{error}</div>}
          {client && stats && (
            <>
              <div className={firms.head}>
                <div style={{ flex: 1 }}>
                  <h1 className={firms.title}>{client.name}</h1>
                  <div className={firms.nums} style={{ marginTop: 8 }}>
                    <span><b>{number(stats.memory)}</b> cümle bellekte</span>
                    <span><b>{number(stats.terms)}</b> terim</span>
                    <span><b>{number(stats.documents)}</b> belge</span>
                    <span><b>{number(stats.suggestions)}</b> bekleyen öneri</span>
                  </div>
                </div>
              </div>
              <div className={firms.tabs}>
                {TABS.map((item) => (
                  <button key={item.id} type="button" className={tab === item.id ? `${firms.tab} ${firms.tabOn}` : firms.tab} onClick={() => setTab(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
              {tab === "terimce" && <TermsTab client={client} onChange={() => void load()} />}
              {tab === "yukle" && <UploadTab client={client} onChange={() => void load()} />}
              {tab === "oneriler" && <SuggestionsTab client={client} onChange={() => void load()} />}
              {tab === "belgeler" && <DocumentsTab client={client} />}
              {tab === "ayarlar" && <SettingsTab client={client} onSaved={setClient} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```
Bu görevde `UploadTab` ve `SuggestionsTab` aynı dosyada ilk hâlleriyle tanımlanır (Task 10/12/16 genişletir):

```tsx
function UploadTab({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  return <ImportPanel client={client} onChange={onChange} />;
}

function SuggestionsTab({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  return <SuggestionPanel client={client} onChange={onChange} />;
}
```
`ImportPanel` Task 10'da `app/ceviri-app/firmalar/[slug]/import-panel.tsx`, `SuggestionPanel` Task 16'da `suggestion-panel.tsx` olarak gelir; bu görevde ikisi de aynı adla, yalnızca açıklama paragrafı döndüren dosyalar olarak oluşturulur ve import edilir:

```tsx
// import-panel.tsx (Task 10 genişletir)
"use client";
import firms from "../../firms.module.css";
import type { FirmClient } from "./firm";
export default function ImportPanel({ client }: { client: FirmClient; onChange: () => void }) {
  return <div className={firms.panel}><p className={firms.muted}>{client.name} kütüphanesine dosya yükleme.</p></div>;
}
```
```tsx
// suggestion-panel.tsx (Task 16 genişletir)
"use client";
import firms from "../../firms.module.css";
import type { FirmClient } from "./firm";
export default function SuggestionPanel({ client }: { client: FirmClient; onChange: () => void }) {
  return <div className={firms.panel}><p className={firms.muted}>{client.name} için terim önerileri.</p></div>;
}
```
`firm.tsx` başına: `import ImportPanel from "./import-panel";` ve `import SuggestionPanel from "./suggestion-panel";`

- [ ] **Step 4: Doğrula** — tsc/eslint temiz; yerel sunucuda `/ceviri-app/firmalar/basf` açılır, terim eklenip silinir, ayarlar kaydedilir.

- [ ] **Step 5: Commit** — `git add app/api/ceviri/clients app/ceviri-app/firmalar && git commit -m "Firma sayfası: terimce, ayarlar, belgeler"`

---

### Task 10: Terimce ve TMX içe aktarımı (firmaya)

**Files:**
- Create: `app/api/ceviri/clients/[id]/imports/route.ts`
- Modify: `app/ceviri-app/firmalar/[slug]/import-panel.tsx`

**Interfaces:**
- Consumes: `parseTermbase` (`termbase.ts`), `importTermRows` (`term-store.ts`), `parseTmxUnits` (`tmx.ts`), `insertTmRows`, `toTmRow` (`tm-store.ts`)
- Produces: `POST /api/ceviri/clients/[id]/imports` (multipart `file`) → `{ kind: "termbase-xlsx" | "tmx", stats: Record<string, number> }`.

- [ ] **Step 1: Route**

```ts
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { getClient } from "../../../../../../lib/ceviri/clients";
import { parseTermbase } from "../../../../../../lib/ceviri/termbase";
import { importTermRows } from "../../../../../../lib/ceviri/term-store";
import { parseTmxUnits } from "../../../../../../lib/ceviri/tmx";
import { insertTmRows, toTmRow, type TmRow } from "../../../../../../lib/ceviri/tm-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 60 * 1024 * 1024;

/** Firmanın kütüphanesine terimce (xlsx) ya da çeviri belleği (TMX). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Dosya gerekli." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Dosya 60 MB sınırını aşıyor." }, { status: 400 });
    const name = file.name.toLowerCase();
    const kind = name.endsWith(".xlsx") ? "termbase-xlsx" : name.endsWith(".tmx") ? "tmx" : null;
    if (!kind) return NextResponse.json({ error: "Yalnızca terimce (.xlsx) ve çeviri belleği (.tmx) kabul ediliyor." }, { status: 415 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const supabase = getCeviriSupabase();
    const { data: imp, error: impError } = await supabase
      .from("imports")
      .insert({ kind, filename: file.name, file_hash: createHash("sha256").update(bytes).digest("hex"), client_id: client.id })
      .select("id")
      .single();
    if (impError) throw new Error(impError.message);
    const importId = imp.id as string;

    try {
      let stats: Record<string, number>;
      if (kind === "termbase-xlsx") {
        const parsed = parseTermbase(bytes);
        const result = await importTermRows(parsed.rows, { scope: { scopeType: "client", scopeId: client.id }, importId });
        stats = { rows: parsed.rows.length, concepts: result.concepts, variants: result.variants };
      } else {
        const text = new TextDecoder("utf-8").decode(bytes);
        async function* chunks() {
          for (let i = 0; i < text.length; i += 1 << 20) yield text.slice(i, i + (1 << 20));
        }
        let seen = 0;
        let inserted = 0;
        let merged = 0;
        let batch: TmRow[] = [];
        const flush = async () => {
          if (!batch.length) return;
          const result = await insertTmRows(batch, { importId, clientId: client.id, sectorId: client.default_sector_id });
          inserted += result.inserted;
          merged += result.merged;
          batch = [];
        };
        for await (const unit of parseTmxUnits(chunks())) {
          seen += 1;
          const row = toTmRow(unit);
          if (row) batch.push(row);
          if (batch.length >= 500) await flush();
        }
        await flush();
        stats = { units: seen, inserted, merged };
      }
      await supabase.from("imports").update({ status: "succeeded", stats, finished_at: new Date().toISOString() }).eq("id", importId);
      return NextResponse.json({ kind, stats });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await supabase.from("imports").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", importId);
      throw cause;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "İçe aktarılamadı." }, { status: 500 });
  }
}
```

Not: `upsert_tm_segments` çakışmada `client_id`'yi değiştirmez (mevcut satır başka firmanınsa ya da genelse satır ortak kalır); bu, spec 4'teki "aynı çift = ortak" kuralıyla uyumludur.

- [ ] **Step 2: `import-panel.tsx`** — terimce/TMX kartı:

```tsx
"use client";

import { useState } from "react";
import styles from "../../lingua.module.css";
import firms from "../../firms.module.css";
import { readJson, type FirmClient } from "./firm";

export default function ImportPanel({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(`${file.name} içe aktarılıyor…`);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const payload = await readJson(await fetch(`/api/ceviri/clients/${client.id}/imports`, { method: "POST", body: form }), "İçe aktarılamadı.");
      const stats = payload.stats as Record<string, number>;
      setResult(
        payload.kind === "tmx"
          ? `${file.name}: ${stats.units} birim okundu, ${stats.inserted} yeni cümle, ${stats.merged} mevcut cümleyle birleşti.`
          : `${file.name}: ${stats.concepts} terim eklendi.`,
      );
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "İçe aktarılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={firms.panel}>
      <p className={firms.panelTitle}>Terimce ya da çeviri belleği</p>
      <p className={firms.muted}>
        Terimce Excel&apos;i (.xlsx — Forbidden, Domain, Subdomain, Definition, dil sütunları) ya da TMX. İçerik yalnızca {client.name} için geçerli olur.
      </p>
      <div className={firms.row} style={{ borderTop: 0 }}>
        <input type="file" accept=".xlsx,.tmx" disabled={busy !== null} onChange={(event) => void importFile(event.target.files?.[0])} />
        {busy && <span className={firms.muted}>{busy}</span>}
      </div>
      {result && <p className={firms.ok}>{result}</p>}
      {error && <div className={styles.err}>{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Doğrula** — tsc/eslint temiz. Uçtan uca: küçük bir TMX'i (`$SCRATCHPAD/tmx/*/8b91…/english__turkish.tmx` değil — tek birimlik elle yazılmış bir TMX) BASF'ye yükle; `select count(*) from tm_segments where client_id = <basf> and import_id = <yeni>` ≥ 1.

- [ ] **Step 4: Commit** — `git commit -am "Firmaya terimce ve TMX içe aktarımı"`

---

### Task 11: Gale-Church hizalama (`align.ts`)

**Files:**
- Create: `lib/ceviri/align.ts`
- Test: `tests/ceviri-align.test.ts`

**Interfaces:**
- Produces: `type Bead = { source: number[]; target: number[]; cost: number; confidence: "high" | "medium" | "low" }`, `anchors(text: string): string[]`, `lengthCost(l1: number, l2: number, ratio: number, variance: number): number`, `align(source: string[], target: string[], options?: { ratio?: number; variance?: number }): Bead[]`, `alignedPairs(beads: Bead[], source: string[], target: string[]): Array<{ source: string; target: string; confidence: "high" | "medium" }>`.

- [ ] **Step 1: Testi yaz**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { align, alignedPairs, anchors, lengthCost } from "../lib/ceviri/align.ts";

test("anchors are numbers, codes, e-mails and links; decimal marks are unified", () => {
  const found = anchors("Dose 1,5 L/ha of BAS 703 07 F, see info@basf.com and https://basf.com/tr");
  assert.ok(found.includes("1.5"));
  assert.ok(found.includes("BAS70307F"));
  assert.ok(found.includes("info@basf.com"));
  assert.ok(found.includes("https://basf.com/tr"));
  assert.deepEqual(anchors("1,5 kg"), anchors("1.5 kg"));
});

test("similar lengths are cheap, very different lengths are expensive", () => {
  assert.ok(lengthCost(100, 110, 1.1, 6.8) < lengthCost(100, 300, 1.1, 6.8));
});

test("parallel paragraphs align one to one with high confidence", () => {
  const source = ["Trade name of the product", "Active ingredient: 250 g/L azoxystrobin", "Store below 30 °C in the original container."];
  const target = ["Ürünün ticari adı", "Etken madde: 250 g/L azoksistrobin", "Orijinal ambalajında 30 °C altında saklayın."];
  const beads = align(source, target);
  assert.deepEqual(beads.map((b) => [b.source, b.target]), [[[0], [0]], [[1], [1]], [[2], [2]]]);
  assert.ok(beads.every((b) => b.confidence !== "low"));
});

test("two source sentences joined into one translation become a 2-1 bead", () => {
  const source = ["Registration number 12345.", "The product is stable.", "It must be stored in a cool and dry place away from children.", "Signed 14 July 2025."];
  const target = ["Ruhsat numarası 12345.", "Ürün kararlıdır ve çocuklardan uzakta, serin ve kuru bir yerde saklanmalıdır.", "İmza 14 Temmuz 2025."];
  const beads = align(source, target);
  assert.ok(beads.some((b) => b.source.join() === "1,2" && b.target.join() === "1"), JSON.stringify(beads));
});

test("an extra heading in the translation is skipped, the rest still pairs by its numbers", () => {
  const source = ["Dose: 250 g/ha", "Store below 30 °C", "Keep away from children"];
  const target = ["Doz: 250 g/ha", "Çeviri notu", "30 °C altında saklayın", "Çocuklardan uzak tutun"];
  const pairs = alignedPairs(align(source, target), source, target);
  assert.deepEqual(pairs.map((p) => p.source), source);
  assert.deepEqual(pairs.map((p) => p.target), ["Doz: 250 g/ha", "30 °C altında saklayın", "Çocuklardan uzak tutun"]);
});
```
- [ ] **Step 2: Başarısız olduğunu gör** — `node --import tsx --test tests/ceviri-align.test.ts` → FAIL.

- [ ] **Step 3: Uygula**

```ts
/**
 * Referans çiftlerinin hizalanması (spec 5.4): bir firmanın eski kaynak
 * belgesi ile çevirisinin paragrafları eşlenir, eşlenen çiftler firmanın
 * belleğine girer.
 *
 * Gale-Church (1993) dinamik programlaması: paragrafların karakter
 * uzunlukları çevirinin uzunluk oranıyla karşılaştırılır; izin verilen
 * eşleşmeler 1-1, 1-0, 0-1, 2-1, 1-2. Buna çapa eklenir: sayılar, kodlar,
 * e-posta ve bağlantılar çeviride aynen kalır; iki tarafta aynı çapayı
 * taşıyan paragraflar birbirine çekilir, çapası tutmayan itilir.
 */

export type Bead = { source: number[]; target: number[]; cost: number; confidence: "high" | "medium" | "low" };

const PRIORS: Record<string, number> = { "1-1": 0.89, "1-0": 0.0099, "0-1": 0.0099, "2-1": 0.0445, "1-2": 0.0445 };
const MOVES: Array<[number, number]> = [[1, 1], [1, 0], [0, 1], [2, 1], [1, 2]];
/** Çapa başına maliyet (nats): ortak çapa çeker, eşsiz çapa iter. */
const SHARED = -1.2;
const MISSING = 0.9;

function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Uzunluk uyumsuzluğunun maliyeti: -log P(|δ|). */
export function lengthCost(l1: number, l2: number, ratio: number, variance: number): number {
  if (l1 === 0 && l2 === 0) return 0;
  const mean = (l1 + l2 / ratio) / 2;
  const delta = (l2 - l1 * ratio) / Math.sqrt(Math.max(mean, 1) * variance);
  const p = 2 * (1 - normalCdf(Math.abs(delta)));
  return -Math.log(Math.max(p, 1e-12));
}

const ANCHOR = /https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\b[A-Z]{1,4}[\s-]?\d{2,}(?:[\s-]\d{2,3}){0,2}(?:\s?[A-Z]\b)?|\d+(?:[.,]\d+)*/g;

/** Çeviride aynen kalması gereken parçalar; ondalık işareti ve boşluklar birleştirilir. */
export function anchors(text: string): string[] {
  return (text.match(ANCHOR) ?? []).map((raw) => {
    if (/^https?:|@/.test(raw)) return raw.replace(/[.,;:)]+$/, "");
    if (/^\d/.test(raw)) return raw.replace(/,/g, ".");
    return raw.replace(/[\s-]/g, "");
  });
}

function anchorCost(a: string[], b: string[]): { cost: number; missing: number } {
  if (!a.length && !b.length) return { cost: 0, missing: 0 };
  const left = new Map<string, number>();
  for (const item of a) left.set(item, (left.get(item) ?? 0) + 1);
  let shared = 0;
  for (const item of b) {
    const n = left.get(item) ?? 0;
    if (n > 0) {
      shared += 1;
      left.set(item, n - 1);
    }
  }
  const missing = a.length + b.length - 2 * shared;
  return { cost: SHARED * shared + MISSING * missing, missing };
}

export function align(source: string[], target: string[], options: { ratio?: number; variance?: number } = {}): Bead[] {
  const n = source.length;
  const m = target.length;
  const totalSource = source.reduce((sum, s) => sum + s.length, 0);
  const totalTarget = target.reduce((sum, s) => sum + s.length, 0);
  const ratio = options.ratio ?? (totalSource ? totalTarget / totalSource : 1) || 1;
  const variance = options.variance ?? 6.8;
  const sourceAnchors = source.map(anchors);
  const targetAnchors = target.map(anchors);

  const width = m + 1;
  const cost = new Float64Array((n + 1) * width).fill(Infinity);
  const back = new Int8Array((n + 1) * width).fill(-1);
  cost[0] = 0;

  const beadCost = (i: number, j: number, di: number, dj: number) => {
    let l1 = 0;
    let l2 = 0;
    const a: string[] = [];
    const b: string[] = [];
    for (let k = i - di; k < i; k++) {
      l1 += source[k].length;
      a.push(...sourceAnchors[k]);
    }
    for (let k = j - dj; k < j; k++) {
      l2 += target[k].length;
      b.push(...targetAnchors[k]);
    }
    const anchor = anchorCost(a, b);
    const lc = lengthCost(l1, l2, ratio, variance);
    return { total: lc - Math.log(PRIORS[`${di}-${dj}`]) + anchor.cost, length: lc, missing: anchor.missing };
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      let move = -1;
      MOVES.forEach(([di, dj], index) => {
        if (i < di || j < dj) return;
        const previous = cost[(i - di) * width + (j - dj)];
        if (!Number.isFinite(previous)) return;
        const total = previous + beadCost(i, j, di, dj).total;
        if (total < best) {
          best = total;
          move = index;
        }
      });
      cost[i * width + j] = best;
      back[i * width + j] = move;
    }
  }

  const beads: Bead[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const [di, dj] = MOVES[back[i * width + j]];
    const detail = beadCost(i, j, di, dj);
    const paired = di > 0 && dj > 0;
    const confidence: Bead["confidence"] = !paired
      ? "low"
      : detail.length < 2.5 && detail.missing === 0
        ? "high"
        : detail.length < 6 && detail.missing <= 1
          ? "medium"
          : "low";
    beads.push({
      source: Array.from({ length: di }, (_, k) => i - di + k),
      target: Array.from({ length: dj }, (_, k) => j - dj + k),
      cost: detail.total,
      confidence,
    });
    i -= di;
    j -= dj;
  }
  return beads.reverse();
}

/** Belleğe girmeye aday çiftler: düşük güvenli ve tek taraflı eşleşmeler atılır. */
export function alignedPairs(beads: Bead[], source: string[], target: string[]): Array<{ source: string; target: string; confidence: "high" | "medium" }> {
  return beads
    .filter((bead) => bead.confidence !== "low" && bead.source.length && bead.target.length)
    .map((bead) => ({
      source: bead.source.map((k) => source[k]).join(" "),
      target: bead.target.map((k) => target[k]).join(" "),
      confidence: bead.confidence as "high" | "medium",
    }));
}
```

- [ ] **Step 4: Geçtiğini gör** — `node --import tsx --test tests/ceviri-align.test.ts` → 5 pass. Test başarısızsa (ör. 2-1 birleşmesi bulunmuyor) sabitler (`SHARED`, `MISSING`, eşikler) test verisine değil gerçek davranışa göre ayarlanır ve testteki beklenti değişmez.

- [ ] **Step 5: Commit** — `git add lib/ceviri/align.ts tests/ceviri-align.test.ts && git commit -m "Gale-Church hizalama, sayı ve kod çapalarıyla"`

---

### Task 12: Referans çiftleri — dosya eşleme, içe aktarma, arayüz

**Files:**
- Create: `lib/ceviri/pair-files.ts`, `lib/ceviri/reference-import.ts`, `app/api/ceviri/clients/[id]/references/route.ts`, `app/api/ceviri/clients/[id]/references/zip/route.ts`
- Modify: `app/ceviri-app/firmalar/[slug]/import-panel.tsx`
- Test: `tests/ceviri-pair-files.test.ts`

**Interfaces:**
- Consumes: `align`, `alignedPairs` (Task 11); `parseDocx`; `activeOcrProvider`, `ocrToSegments`, `isPdf`; `imageFormat`, `imageToPdf`; `askOpenAI`; `insertTmRows`, `toTmRow`
- Produces: `pairReferenceFiles(names: string[]): { pairs: Array<{ source: string; target: string }>; unmatched: string[] }`; `importReferencePair(input: { clientId: string; sectorId: string | null; importId: string; sourceName: string; sourceBytes: Uint8Array; targetBytes: Uint8Array; sourceLang: string; targetLang: string }): Promise<{ aligned: number; verified: number; dropped: number; stored: number }>`; `POST .../references` (multipart `source`+`target` ya da JSON `{ sourcePath, targetPath, sourceName, sourceLang, targetLang, importId? }`) → `{ importId, stats }`; `POST .../references/zip` (multipart `file`) → `{ importId, pairs: Array<{ source: string; target: string; sourcePath: string; targetPath: string }>, unmatched: string[] }`.

- [ ] **Step 1: Eşleme testini yaz** — `tests/ceviri-pair-files.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { pairReferenceFiles } from "../lib/ceviri/pair-files.ts";

test("pairs a scan with its translation by the shared name, whatever the language tag", () => {
  const { pairs, unmatched } = pairReferenceFiles([
    "arşiv/banka/eur-hesap-hareketleri.pdf",
    "arşiv/banka/eur-hesap-hareketleri_EN.docx",
    "arşiv/bordro/bordro.pdf",
    "arşiv/bordro/bordro-en.docx",
    "arşiv/adli sicil/Adli Sicil-Es.pdf",
    "arşiv/adli sicil/Adli Sicil-Es.docx",
    "arşiv/bordro/Earning certificado de retenciones 2025.pdf",
    "arşiv/bordro/Earning certificado de retenciones 2025 TR.docx",
  ]);
  assert.deepEqual(
    pairs.map((p) => [p.source, p.target]).sort(),
    [
      ["arşiv/adli sicil/Adli Sicil-Es.pdf", "arşiv/adli sicil/Adli Sicil-Es.docx"],
      ["arşiv/banka/eur-hesap-hareketleri.pdf", "arşiv/banka/eur-hesap-hareketleri_EN.docx"],
      ["arşiv/bordro/Earning certificado de retenciones 2025.pdf", "arşiv/bordro/Earning certificado de retenciones 2025 TR.docx"],
      ["arşiv/bordro/bordro.pdf", "arşiv/bordro/bordro-en.docx"],
    ].sort(),
  );
  assert.deepEqual(unmatched, []);
});

test("two Word files: the one with a language tag is the translation; copy counters are ignored", () => {
  const { pairs } = pairReferenceFiles(["cv/Olga's Resume (1) (1).docx", "cv/Olga's Resume (1) (1) (1)-rus.docx"]);
  assert.deepEqual(pairs, [{ source: "cv/Olga's Resume (1) (1).docx", target: "cv/Olga's Resume (1) (1) (1)-rus.docx" }]);
});

test("files in different folders never pair, and leftovers are reported", () => {
  const { pairs, unmatched } = pairReferenceFiles(["a/form.pdf", "b/form-TR.docx", "c/notes.txt"]);
  assert.deepEqual(pairs, []);
  assert.deepEqual(unmatched.sort(), ["a/form.pdf", "b/form-TR.docx", "c/notes.txt"]);
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — `node --import tsx --test tests/ceviri-pair-files.test.ts` → FAIL.

- [ ] **Step 3: `pair-files.ts`**

```ts
import { fold } from "./fold";

/**
 * Zip içindeki kaynak ve çeviri dosyalarının eşlenmesi (spec 5.4). Arşivlerde
 * çeviri, kaynağın adına bir dil eki eklenerek saklanıyor: "bordro.pdf" ↔
 * "bordro-en.docx", "X.pdf" ↔ "X TR.docx", "Adli Sicil-Es.pdf" ↔ "Adli
 * Sicil-Es.docx". Dil ekleri ve "(1)" kopya sayaçları atılınca kalan ad aynı
 * klasörde eşleşir. Kaynak taranmış belge (PDF/görsel) ya da Word'dür; çeviri
 * Word'dür.
 */

const SOURCE = /\.(pdf|jpe?g|png|webp|tiff?|docx)$/i;
const TAG = /(?:[\s_\-(]+)(tr|en|es|de|fr|it|ru|rus|el|pl|ro|ar|pt|nl|translation|ceviri|çeviri|revised|final|\d+)\)?$/i;

function parts(path: string): { folder: string; stem: string; tagged: boolean; word: boolean } {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  let stem = path.slice(slash + 1).replace(/\.[^.]+$/, "");
  let tagged = false;
  for (let i = 0; i < 6; i++) {
    const match = TAG.exec(stem);
    if (!match) break;
    if (!/^\d+$/.test(match[1])) tagged = true;
    stem = stem.slice(0, match.index);
  }
  return { folder, stem: fold(stem).replace(/[^\p{L}\p{N}]+/gu, ""), tagged, word: /\.docx$/i.test(path) };
}

export function pairReferenceFiles(names: string[]): { pairs: Array<{ source: string; target: string }>; unmatched: string[] } {
  const groups = new Map<string, string[]>();
  const unmatched: string[] = [];
  for (const name of names) {
    if (!SOURCE.test(name)) {
      unmatched.push(name);
      continue;
    }
    const info = parts(name);
    const key = `${info.folder}\u0000${info.stem}`;
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }

  const pairs: Array<{ source: string; target: string }> = [];
  for (const files of groups.values()) {
    const words = files.filter((file) => parts(file).word);
    const scans = files.filter((file) => !parts(file).word);
    let source: string | undefined;
    let target: string | undefined;
    if (scans.length >= 1 && words.length >= 1) {
      source = scans[0];
      target = words.find((file) => parts(file).tagged) ?? words[0];
    } else if (words.length === 2) {
      const [a, b] = words;
      if (parts(a).tagged !== parts(b).tagged) {
        target = parts(a).tagged ? a : b;
        source = target === a ? b : a;
      }
    }
    if (source && target) {
      pairs.push({ source, target });
      unmatched.push(...files.filter((file) => file !== source && file !== target));
    } else unmatched.push(...files);
  }
  return { pairs, unmatched };
}
```
Not: `(1)` gibi kopya sayaçları `\d+` kolundan atılır ama `tagged` saymaz.

- [ ] **Step 4: Geçtiğini gör** — `node --import tsx --test tests/ceviri-pair-files.test.ts` → 3 pass.

- [ ] **Step 5: `reference-import.ts`**

```ts
import { alignedPairs, align } from "./align";
import { parseDocx } from "./docx";
import { imageFormat, imageToPdf } from "./image-doc";
import { activeOcrProvider, isPdf, ocrToSegments } from "./ocr";
import { askOpenAI } from "./translate";
import { insertTmRows, toTmRow } from "./tm-store";

/**
 * Referans çiftini firmanın belleğine alır (spec 5.4): kaynak ve çeviri
 * metinleri çıkarılır, Gale-Church ile hizalanır, orta güvenli eşleşmeler
 * yapay zekâya doğrulatılır, doğrulanan ve yüksek güvenli çiftler
 * `origin = reference` olarak yazılır.
 */

/** Kişisel veri: yalnızca özel ad ve sayıdan oluşan kısa satırlar (isim, T.C. no) belleğe alınmaz. */
function personal(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length <= 4 && words.every((word) => /\d/.test(word) || /^\p{Lu}/u.test(word));
}

export async function extractTexts(name: string, bytes: Uint8Array, lang: string): Promise<string[]> {
  if (/\.docx$/i.test(name)) return parseDocx(bytes).segments.map((segment) => segment.text);
  const image = imageFormat(bytes);
  if (!isPdf(bytes) && !image) throw new Error(`${name}: PDF, görsel ya da Word değil.`);
  const pdf = image ? await imageToPdf(bytes) : bytes;
  const result = await activeOcrProvider().run(pdf, { lang });
  if (result.demo) throw new Error("OCR sağlayıcısı bağlı değil; taranmış kaynak okunamıyor.");
  return ocrToSegments(result).map((segment) => segment.text);
}

/** Orta güvenli eşleşmeleri tek istekte doğrulatır; yanıtı okunamazsa hiçbiri kabul edilmez. */
async function verify(pairs: Array<{ source: string; target: string }>, sourceLang: string, targetLang: string): Promise<boolean[]> {
  if (!pairs.length) return [];
  const prompt = [
    `Each item is a ${sourceLang} text and a ${targetLang} text taken from a document and its translation.`,
    "For each item answer true if the second text is a translation of the first (allowing minor omissions), otherwise false.",
    'Reply with JSON only: {"answers": [true, false, ...]} in the same order.',
    "",
    ...pairs.map((pair, index) => `${index + 1}. ${JSON.stringify(pair.source)} => ${JSON.stringify(pair.target)}`),
  ].join("\n");
  try {
    const reply = await askOpenAI(prompt, process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23");
    const match = /\{[\s\S]*\}/.exec(reply);
    const answers = match ? (JSON.parse(match[0]).answers as unknown[]) : [];
    return pairs.map((_, index) => answers[index] === true);
  } catch {
    return pairs.map(() => false);
  }
}

export async function importReferencePair(input: {
  clientId: string;
  sectorId: string | null;
  importId: string;
  sourceName: string;
  sourceBytes: Uint8Array;
  targetBytes: Uint8Array;
  sourceLang: string;
  targetLang: string;
}): Promise<{ aligned: number; verified: number; dropped: number; stored: number }> {
  const source = (await extractTexts(input.sourceName, input.sourceBytes, input.sourceLang)).filter((text) => text.trim());
  const target = parseDocx(input.targetBytes).segments.map((segment) => segment.text).filter((text) => text.trim());
  const beads = align(source, target);
  const candidates = alignedPairs(beads, source, target).filter((pair) => !personal(pair.source) && !personal(pair.target));
  const high = candidates.filter((pair) => pair.confidence === "high");
  const medium = candidates.filter((pair) => pair.confidence === "medium");
  const verdicts = [];
  for (let i = 0; i < medium.length; i += 40) verdicts.push(...(await verify(medium.slice(i, i + 40), input.sourceLang, input.targetLang)));
  const accepted = [...high, ...medium.filter((_, index) => verdicts[index])];

  const rows = accepted
    .map((pair) =>
      toTmRow({
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        sourceText: pair.source,
        targetText: pair.target,
        projectName: `referans:${input.sourceName}`,
        contextPre: null,
        contextPost: null,
        origin: null,
      }),
    )
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map((row) => ({ ...row, origin: "reference" }));
  const result = rows.length
    ? await insertTmRows(rows, { importId: input.importId, clientId: input.clientId, sectorId: input.sectorId })
    : { inserted: 0, merged: 0 };
  return {
    aligned: beads.filter((bead) => bead.source.length && bead.target.length).length,
    verified: verdicts.filter(Boolean).length,
    dropped: beads.length - accepted.length,
    stored: result.inserted + result.merged,
  };
}
```
Not: `upsert_tm_segments` `origin`'i girişten alır; mevcut bir satırla çakışırsa `origin` değişmez (RPC yalnızca `project_names`'i birleştirir) — kabul edilebilir.

- [ ] **Step 6: `references/route.ts`**

```ts
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { CEVIRI_DOCS_BUCKET, getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { getClient } from "../../../../../../lib/ceviri/clients";
import { importReferencePair } from "../../../../../../lib/ceviri/reference-import";

export const runtime = "nodejs";
export const maxDuration = 300;

async function download(path: string): Promise<Uint8Array> {
  const { data, error } = await getCeviriSupabase().storage.from(CEVIRI_DOCS_BUCKET).download(path);
  if (error || !data) throw new Error(`Dosya okunamadı: ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Tek referans çifti: ya iki dosya (multipart `source`, `target`) ya da zip
 * yüklemesinin depoya koyduğu yollar (JSON). Aynı `importId` ile gelen çiftler
 * tek içe aktarım kaydında toplanır.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const supabase = getCeviriSupabase();

    let sourceName: string;
    let sourceBytes: Uint8Array;
    let targetBytes: Uint8Array;
    let sourceLang: string;
    let targetLang: string;
    let importId: string | null = null;
    let filename: string;

    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await request.json()) as Record<string, string>;
      sourceName = body.sourceName;
      sourceBytes = await download(body.sourcePath);
      targetBytes = await download(body.targetPath);
      sourceLang = body.sourceLang ?? "en-US";
      targetLang = body.targetLang ?? "tr-TR";
      importId = body.importId ?? null;
      filename = sourceName;
    } else {
      const form = await request.formData();
      const source = form.get("source");
      const target = form.get("target");
      if (!(source instanceof File) || !(target instanceof File)) {
        return NextResponse.json({ error: "Kaynak ve çeviri dosyası gerekli." }, { status: 400 });
      }
      if (!target.name.toLowerCase().endsWith(".docx")) {
        return NextResponse.json({ error: "Çeviri Word (.docx) olmalı." }, { status: 415 });
      }
      sourceName = source.name;
      sourceBytes = new Uint8Array(await source.arrayBuffer());
      targetBytes = new Uint8Array(await target.arrayBuffer());
      sourceLang = String(form.get("sourceLang") ?? "en-US");
      targetLang = String(form.get("targetLang") ?? "tr-TR");
      filename = `${source.name} ↔ ${target.name}`;
    }

    if (!importId) {
      const { data, error } = await supabase
        .from("imports")
        .insert({ kind: "reference-pair", filename, file_hash: createHash("sha256").update(sourceBytes).digest("hex"), client_id: client.id })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      importId = data.id as string;
    }

    const stats = await importReferencePair({
      clientId: client.id,
      sectorId: client.default_sector_id,
      importId,
      sourceName,
      sourceBytes,
      targetBytes,
      sourceLang,
      targetLang,
    });

    const { data: current } = await supabase.from("imports").select("stats").eq("id", importId).single();
    const previous = (current?.stats as Record<string, number> | null) ?? {};
    const merged = Object.fromEntries(
      ["aligned", "verified", "dropped", "stored", "pairs"].map((key) => [
        key,
        (previous[key] ?? 0) + (key === "pairs" ? 1 : (stats as Record<string, number>)[key]),
      ]),
    );
    await supabase.from("imports").update({ stats: merged, status: "succeeded", finished_at: new Date().toISOString() }).eq("id", importId);
    return NextResponse.json({ importId, stats });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Referans işlenemedi." }, { status: 500 });
  }
}
```

- [ ] **Step 7: `references/zip/route.ts`**

```ts
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../../lib/auth";
import { CEVIRI_DOCS_BUCKET, getCeviriSupabase } from "../../../../../../../lib/ceviri/supabase";
import { getClient } from "../../../../../../../lib/ceviri/clients";
import { pairReferenceFiles } from "../../../../../../../lib/ceviri/pair-files";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Zip'i açar, kaynak/çeviri dosyalarını eşler, eşlenen dosyaları depoya
 * koyar. Çiftler tek tek `/references`'a gönderilir: her çift OCR ve
 * hizalamayla bir dakikayı bulabilir, tek istekte hepsi zaman aşımına düşerdi.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Zip dosyası gerekli." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Zip 200 MB sınırını aşıyor." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Windows'ta sıkıştırılmış arşivlerde Türkçe adlar UTF-8 işaretsiz gelir ve
    // bozuk görünür ("arŸiv"); eşleme aynı klasördeki adları birbiriyle
    // karşılaştırdığı için bozulma iki tarafta aynıdır ve eşlemeyi etkilemez.
    const entries = unzipSync(bytes);
    const files = new Map(Object.entries(entries).filter(([name, data]) => data.length && !name.endsWith("/")));
    const { pairs, unmatched } = pairReferenceFiles([...files.keys()]);

    const supabase = getCeviriSupabase();
    const { data: imp, error } = await supabase
      .from("imports")
      .insert({ kind: "reference-archive", filename: file.name, file_hash: createHash("sha256").update(bytes).digest("hex"), client_id: client.id, stats: { found: pairs.length, unmatched: unmatched.length } })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const importId = imp.id as string;

    const staged = [];
    for (const [index, pair] of pairs.entries()) {
      const paths = [pair.source, pair.target].map((name, side) => `references/${importId}/${index}-${side}-${createHash("sha1").update(name).digest("hex").slice(0, 10)}${name.slice(name.lastIndexOf("."))}`);
      for (const [side, name] of [pair.source, pair.target].entries()) {
        const { error: uploadError } = await supabase.storage.from(CEVIRI_DOCS_BUCKET).upload(paths[side], files.get(name)!, { upsert: true });
        if (uploadError) throw new Error(`Depolama hatası: ${uploadError.message}`);
      }
      staged.push({ source: pair.source, target: pair.target, sourcePath: paths[0], targetPath: paths[1] });
    }
    return NextResponse.json({ importId, pairs: staged, unmatched });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Zip işlenemedi." }, { status: 500 });
  }
}
```

- [ ] **Step 8: `import-panel.tsx`'e referans kartları** — mevcut dönüşü `<>…</>` içine al ve terimce kartından sonra ekle:

```tsx
      <div className={firms.panel}>
        <p className={firms.panelTitle}>Referans çevirisi (orijinal + çevirisi)</p>
        <p className={firms.muted}>
          Eski bir belge ve bu firmaya yaptığınız çevirisi. Paragraflar sayı, kod ve uzunluklarına göre eşlenir; emin olunamayanlar
          yapay zekâya doğrulatılır; eşlenenler {client.name} belleğine girer.
        </p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <label className={firms.muted}>Orijinal <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.docx" onChange={(e) => setPair({ ...pair, source: e.target.files?.[0] ?? null })} /></label>
          <label className={firms.muted}>Çevirisi (.docx) <input type="file" accept=".docx" onChange={(e) => setPair({ ...pair, target: e.target.files?.[0] ?? null })} /></label>
          <select className={firms.select} value={langs.source} onChange={(e) => setLangs({ ...langs, source: e.target.value })}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
          <span>→</span>
          <select className={firms.select} value={langs.target} onChange={(e) => setLangs({ ...langs, target: e.target.value })}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
          <button className={styles.primary} type="button" disabled={busy !== null || !pair.source || !pair.target} onClick={() => void sendPair()}>Hizala ve ekle</button>
        </div>
      </div>
      <div className={firms.panel}>
        <p className={firms.panelTitle}>Arşiv (zip)</p>
        <p className={firms.muted}>Orijinaller ve çevirileri aynı klasörde, çeviri adında dil eki olacak şekilde (bordro.pdf ↔ bordro-en.docx). Çiftler tek tek işlenir.</p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <input type="file" accept=".zip" disabled={busy !== null} onChange={(e) => void sendZip(e.target.files?.[0])} />
        </div>
        {progress && <p className={firms.muted}>{progress}</p>}
      </div>
```
Bileşene state ve fonksiyonlar:

```tsx
  const [pair, setPair] = useState<{ source: File | null; target: File | null }>({ source: null, target: null });
  const [langs, setLangs] = useState({ source: "en-US", target: "tr-TR" });
  const [progress, setProgress] = useState<string | null>(null);

  const describe = (stats: Record<string, number>) =>
    `${stats.aligned} paragraf eşlendi, ${stats.verified} tanesi doğrulatıldı, ${stats.stored} çift belleğe yazıldı, ${stats.dropped} atıldı.`;

  async function sendPair() {
    if (!pair.source || !pair.target) return;
    setBusy("Hizalanıyor… (taranmış belgede bir dakika sürebilir)");
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("source", pair.source);
      form.append("target", pair.target);
      form.append("sourceLang", langs.source);
      form.append("targetLang", langs.target);
      const payload = await readJson(await fetch(`/api/ceviri/clients/${client.id}/references`, { method: "POST", body: form }), "Referans işlenemedi.");
      setResult(`${pair.source.name}: ${describe(payload.stats)}`);
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Referans işlenemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function sendZip(file: File | undefined) {
    if (!file) return;
    setBusy("Zip açılıyor…");
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const staged = await readJson(await fetch(`/api/ceviri/clients/${client.id}/references/zip`, { method: "POST", body: form }), "Zip işlenemedi.");
      const pairs = staged.pairs as Array<{ source: string; target: string; sourcePath: string; targetPath: string }>;
      let stored = 0;
      let failed = 0;
      for (const [index, item] of pairs.entries()) {
        setProgress(`${index + 1}/${pairs.length}: ${item.source.split("/").pop()}`);
        try {
          const payload = await readJson(
            await fetch(`/api/ceviri/clients/${client.id}/references`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...item, sourceName: item.source, sourceLang: langs.source, targetLang: langs.target, importId: staged.importId }),
            }),
            "Çift işlenemedi.",
          );
          stored += (payload.stats as Record<string, number>).stored;
        } catch {
          failed += 1;
        }
      }
      setProgress(null);
      setResult(`${pairs.length} çift işlendi, ${stored} cümle belleğe yazıldı${failed ? `, ${failed} çift okunamadı` : ""}. Eşlenemeyen dosya: ${(staged.unmatched as string[]).length}.`);
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Zip işlenemedi.");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }
```
Import: `import { LANGS, readJson, type FirmClient } from "./firm";`

- [ ] **Step 9: Doğrula** — tsc/eslint; `node --import tsx --test tests/ceviri-pair-files.test.ts tests/ceviri-align.test.ts`; uçtan uca: BASF ARŞİV'den bir Word+Word ya da PDF+Word çiftini BASF'ye yükle, `stored > 0`.

- [ ] **Step 10: Commit** — `git add lib/ceviri/pair-files.ts lib/ceviri/reference-import.ts app/api/ceviri/clients app/ceviri-app/firmalar tests/ceviri-pair-files.test.ts && git commit -m "Referans çiftleri: dosya eşleme, hizalama, doğrulama, firmanın belleğine yazma"`

---

## FAZ 3 — Otomatik firma tespiti

### Task 13: Parmak izi (`signatures.ts`)

**Files:**
- Create: `lib/ceviri/signatures.ts`, `app/api/ceviri/clients/signatures/route.ts`
- Test: `tests/ceviri-signatures.test.ts`

**Interfaces:**
- Consumes: `countCase`, `isProper`, `tokensOf` (Task 2)
- Produces: `type SignatureDoc = { clientId: string | null; texts: string[] }`, `type Signature = { clientId: string; token: string; weight: number; rows: number }`, `SIGNATURE_RULES`, `buildSignatures(docs: SignatureDoc[], rules?): Signature[]`; `POST /api/ceviri/clients/signatures` → `{ signatures: number; documents: number }`.

- [ ] **Step 1: Testi yaz**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildSignatures } from "../lib/ceviri/signatures.ts";

const doc = (clientId: string | null, ...texts: string[]) => ({ clientId, texts });

test("a product name used only in one firm's documents becomes its signature", () => {
  const signatures = buildSignatures([
    doc("basf", "We apply Revysol on wheat.", "The workplace must be clean.", "The Revysol label is stable."),
    doc("basf", "Apply Revysol twice.", "Our workplace rules apply."),
    doc("syngenta", "Always use Touchdown carefully.", "It said Touchdown kills weeds.", "The workplace matters."),
    doc("syngenta", "Store Touchdown below 30 °C."),
    doc(null, "A safe workplace is important."),
  ]);
  const byToken = new Map(signatures.map((s) => [s.token, s]));
  assert.equal(byToken.get("revysol")?.clientId, "basf");
  assert.equal(byToken.get("touchdown")?.clientId, "syngenta");
  assert.equal(byToken.has("workplace"), false, "everyday words are not signatures");
});

test("a code seen in one firm's documents is a signature; a name used by two firms is not", () => {
  const signatures = buildSignatures([
    doc("basf", "Product BAS 703 07 F registered by Bayer."),
    doc("basf", "BAS 703 07 F label. Also mentions Bayer."),
    doc("basf", "Formulation BAS 703 07 F."),
    doc("syngenta", "Supplied by Bayer to us."),
    doc("syngenta", "Contract with Bayer."),
  ]);
  const tokens = signatures.map((s) => `${s.clientId}:${s.token}`);
  assert.ok(tokens.includes("basf:bas 703 07 f"));
  assert.equal(tokens.some((t) => t.endsWith(":bayer")), false);
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — FAIL (modül yok).

- [ ] **Step 3: Uygula**

```ts
import { countCase, isProper, tokensOf, type CaseCounts } from "./fold";

/**
 * Firma parmak izi (spec 5.2): firmayı ayırt eden özel adlar ve kodlar
 * (ürün adları, BAS kodları, tesis adları). Eski arşiv taramasında firma adı
 * geçmeyen 16 Syngenta projesi Topas, Captan, Tonghai gibi ifadelerden
 * bulundu. `docs` birer proje ya da belgedir; firması bilinmeyenler de sayıma
 * girer: bir kelimenin ne kadar yaygın olduğunu onlar gösterir.
 */

export type SignatureDoc = { clientId: string | null; texts: string[] };
export type Signature = { clientId: string; token: string; weight: number; rows: number };

export const SIGNATURE_RULES = { minDocs: 2, minRows: 3, minShare: 0.9, maxDocs: 25 };

export function buildSignatures(docs: SignatureDoc[], rules = SIGNATURE_RULES): Signature[] {
  const counts: CaseCounts = { proper: new Map(), all: new Map() };
  const byToken = new Map<string, { docs: number; perClient: Map<string, { docs: number; rows: number }> }>();

  for (const doc of docs) {
    countCase(doc.texts, counts);
    const rows = new Map<string, number>();
    for (const text of doc.texts) for (const token of tokensOf(text)) rows.set(token, (rows.get(token) ?? 0) + 1);
    for (const [token, n] of rows) {
      let entry = byToken.get(token);
      if (!entry) byToken.set(token, (entry = { docs: 0, perClient: new Map() }));
      entry.docs += 1;
      if (!doc.clientId) continue;
      const own = entry.perClient.get(doc.clientId) ?? { docs: 0, rows: 0 };
      own.docs += 1;
      own.rows += n;
      entry.perClient.set(doc.clientId, own);
    }
  }

  const signatures: Signature[] = [];
  for (const [token, entry] of byToken) {
    if (entry.docs > rules.maxDocs || !entry.perClient.size) continue;
    const labeled = [...entry.perClient.values()].reduce((sum, value) => sum + value.docs, 0);
    const [clientId, best] = [...entry.perClient].sort((a, b) => b[1].docs - a[1].docs)[0];
    const share = best.docs / labeled;
    if (best.docs < rules.minDocs || best.rows < rules.minRows || share < rules.minShare) continue;
    if (!isProper(token, counts)) continue;
    signatures.push({ clientId, token, weight: share, rows: best.rows });
  }
  return signatures;
}
```

- [ ] **Step 4: Geçtiğini gör** — 2 pass.

- [ ] **Step 5: Yeniden kurma API'si** — `app/api/ceviri/clients/signatures/route.ts`

```ts
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../lib/ceviri/supabase";
import { buildSignatures, type SignatureDoc } from "../../../../../lib/ceviri/signatures";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Parmak izini bütün bellekten yeniden kurar. Belge birimi proje adıdır
 * (eski arşiv) ya da referans/düzeltme için "firma:köken" grubu. Kaynak metin
 * yeterli: ürün adları ve kodlar iki tarafta da aynıdır.
 */
export async function POST() {
  try {
    await requireAdminSession();
    const supabase = getCeviriSupabase();
    const groups = new Map<string, { texts: string[]; tally: Map<string, number> }>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("tm_segments")
        .select("source_text, project_names, client_id, origin")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ source_text: string; project_names: string[]; client_id: string | null; origin: string }>) {
        const key = row.origin === "tmx-import" ? `p:${row.project_names[0] ?? "-"}` : `o:${row.client_id ?? "-"}:${row.origin}`;
        let group = groups.get(key);
        if (!group) groups.set(key, (group = { texts: [], tally: new Map() }));
        // Aynı projede ortak (firmasız) satırlar da olur: grubun firması firmalı satırların çoğunluğu.
        if (row.client_id) group.tally.set(row.client_id, (group.tally.get(row.client_id) ?? 0) + 1);
        group.texts.push(row.source_text);
      }
      if (!data || data.length < PAGE) break;
    }
    const docs: SignatureDoc[] = [...groups.values()].map((group) => ({
      clientId: [...group.tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      texts: group.texts,
    }));
    const signatures = buildSignatures(docs);
    const { error: clearError } = await supabase.from("client_signatures").delete().neq("token", "");
    if (clearError) throw new Error(clearError.message);
    for (let i = 0; i < signatures.length; i += 1000) {
      const { error } = await supabase.from("client_signatures").insert(
        signatures.slice(i, i + 1000).map((s) => ({ client_id: s.clientId, token: s.token, weight: s.weight, rows: s.rows })),
      );
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ signatures: signatures.length, documents: groups.size });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parmak izi kurulamadı." }, { status: 500 });
  }
}
```
- [ ] **Step 6: Çalıştır** — yerel sunucuda Firmalar sayfasında "Parmak izini yenile"; `execute_sql`: `select c.slug, count(*) from client_signatures s join clients c on c.id = s.client_id group by 1 order by 2 desc;` — Syngenta, Nase, Bayer, BASF'nin her biri ≥ 20 özgü ifade.

- [ ] **Step 7: Commit** — `git add lib/ceviri/signatures.ts app/api/ceviri/clients/signatures tests/ceviri-signatures.test.ts && git commit -m "Firma parmak izi: özgü ürün adları ve kodlar"`

---

### Task 14: Firma tespiti (`detect-client.ts`) ve yüklemeye bağlama

**Files:**
- Create: `lib/ceviri/detect-client.ts`, `lib/ceviri/client-detection-store.ts`
- Modify: `app/api/ceviri/documents/route.ts`
- Test: `tests/ceviri-detect-client.test.ts`

**Interfaces:**
- Consumes: `fold`, `tokensOf` (Task 2); `listClients` (Task 5); `segmentHash`; `memoryLangs`
- Produces: `type ClientRef = { id: string; name: string; aliases: string[] }`, `nameHits(text: string, clients: ClientRef[]): Map<string, number>`, `signatureHits(tokens: string[], rows: Array<{ client_id: string; token: string; weight: number }>): Map<string, { weight: number; tokens: string[] }>`, `type ScoredClient = { clientId: string; score: number; reasons: string[] }`, `scoreClients(e: { names; signature; memory }): ScoredClient[]`, `type Detection = { decision: "auto" | "suggest" | "ask" | "manual"; clientId: string | null; makerId: string | null; candidates: ScoredClient[] }`, `DETECTION`, `makerFor(names: Map<string, number>, clientId: string | null, rules?): string | null`, `decide(scored, names, rules?): Detection`; `detectForDocument(texts: string[], sourceLang: string, chosen?: string | null): Promise<Detection>`.

- [ ] **Step 1: Testi yaz**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { decide, nameHits, scoreClients, signatureHits } from "../lib/ceviri/detect-client.ts";

const CLIENTS = [
  { id: "basf", name: "BASF", aliases: ["BASF Agricultural Solutions"] },
  { id: "syngenta", name: "Syngenta", aliases: ["Syngenta Crop Protection"] },
  { id: "nase", name: "Nase", aliases: ["Nase İlaç"] },
];

test("names are found on word boundaries, folded, the long form counted once", () => {
  const hits = nameHits("BASF Agricultural Solutions GmbH and basf; not BASFİNE. SYNGENTA CROP PROTECTION AG", CLIENTS);
  assert.equal(hits.get("basf"), 2, "the full name once and lower-case basf once; BASFİNE is another word");
  assert.equal(hits.get("syngenta"), 1);
  assert.equal(hits.has("nase"), false);
});

test("signature tokens add up per firm", () => {
  const hits = signatureHits(["revysol", "workplace", "bas 703 07 f"], [
    { client_id: "basf", token: "revysol", weight: 1 },
    { client_id: "basf", token: "bas 703 07 f", weight: 0.95 },
  ]);
  assert.deepEqual(hits.get("basf")?.tokens.sort(), ["bas 703 07 f", "revysol"]);
  assert.ok(Math.abs((hits.get("basf")?.weight ?? 0) - 1.95) < 1e-9);
});

test("a BASF letter is detected automatically, with reasons", () => {
  const names = new Map([["basf", 2]]);
  const scored = scoreClients({ names, signature: new Map([["basf", { weight: 3, tokens: ["revysol"] }]]), memory: new Map([["basf", 5]]) });
  const detection = decide(scored, names);
  assert.equal(detection.decision, "auto");
  assert.equal(detection.clientId, "basf");
  assert.equal(detection.makerId, null);
  assert.ok(detection.candidates[0].reasons.some((r) => r.includes("5 cümle")));
});

test("a Nase document about a Syngenta product: customer from memory, maker from the name", () => {
  const names = new Map([["syngenta", 4]]);
  const scored = scoreClients({ names, signature: new Map(), memory: new Map([["nase", 12]]) });
  const detection = decide(scored, names);
  assert.equal(detection.decision, "auto");
  assert.equal(detection.clientId, "nase");
  assert.equal(detection.makerId, "syngenta");
});

test("no evidence or two close firms: ask", () => {
  assert.equal(decide(scoreClients({ names: new Map(), signature: new Map(), memory: new Map() }), new Map()).decision, "ask");
  const names = new Map([["basf", 1], ["syngenta", 1]]);
  const close = decide(scoreClients({ names, signature: new Map(), memory: new Map() }), names);
  assert.equal(close.decision, "ask");
  assert.equal(close.clientId, null);
});

test("moderate evidence is a suggestion", () => {
  const names = new Map([["basf", 1]]);
  const detection = decide(scoreClients({ names, signature: new Map(), memory: new Map() }), names);
  assert.equal(detection.decision, "suggest");
  assert.equal(detection.clientId, "basf");
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — FAIL.

- [ ] **Step 3: `detect-client.ts`**

```ts
import { fold } from "./fold";

/**
 * Belgenin firmasını tahmin eder (spec 5.2). Üç ipucu: firmanın adı ve tüzel
 * adları, firma parmak izi (özgü ürün adları ve kodlar) ve belgenin
 * cümlelerinin firmanın belleğinde bulunması. Müşteriyi en iyi bellek
 * yakalar: Nase'nin belgesi Nase'nin eski belgelerine benzer, ama içinde
 * Syngenta'nın ürünü geçer. Üretici ayrıca ad eşleşmesinden bulunur.
 */

export type ClientRef = { id: string; name: string; aliases: string[] };
export type ScoredClient = { clientId: string; score: number; reasons: string[] };
export type Detection = {
  decision: "auto" | "suggest" | "ask" | "manual";
  clientId: string | null;
  makerId: string | null;
  candidates: ScoredClient[];
};

export const DETECTION = { auto: 6, autoMargin: 2, suggest: 3, suggestMargin: 1.5, makerHits: 2 };

const flat = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Firma adı ve takma adları, katlanmış metinde kelime sınırıyla. */
export function nameHits(text: string, clients: ClientRef[]): Map<string, number> {
  const hay = ` ${flat(text)} `;
  const hits = new Map<string, number>();
  for (const client of clients) {
    const needles = [...new Set([client.name, ...client.aliases].map(flat))].filter((needle) => needle.length >= 3);
    // Uzun ad önce sayılır ve metinden çıkarılır: "BASF Agricultural Solutions"
    // hem tam adı hem "BASF"yi saymasın.
    let rest = hay;
    let n = 0;
    for (const needle of needles.sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(`(?<=\\s)${escape(needle)}(?=\\s)`, "gu");
      n += rest.match(pattern)?.length ?? 0;
      rest = rest.replace(pattern, " ");
    }
    if (n) hits.set(client.id, n);
  }
  return hits;
}

export function signatureHits(
  tokens: string[],
  rows: Array<{ client_id: string; token: string; weight: number }>,
): Map<string, { weight: number; tokens: string[] }> {
  const present = new Set(tokens);
  const out = new Map<string, { weight: number; tokens: string[] }>();
  for (const row of rows) {
    if (!present.has(row.token)) continue;
    const entry = out.get(row.client_id) ?? { weight: 0, tokens: [] };
    entry.weight += row.weight;
    entry.tokens.push(row.token);
    out.set(row.client_id, entry);
  }
  return out;
}

export function scoreClients(evidence: {
  names: Map<string, number>;
  signature: Map<string, { weight: number; tokens: string[] }>;
  memory: Map<string, number>;
}): ScoredClient[] {
  const ids = new Set([...evidence.names.keys(), ...evidence.signature.keys(), ...evidence.memory.keys()]);
  return [...ids]
    .map((clientId) => {
      const names = evidence.names.get(clientId) ?? 0;
      const signature = evidence.signature.get(clientId);
      const memory = evidence.memory.get(clientId) ?? 0;
      const reasons: string[] = [];
      if (names) reasons.push(`adı ${names} kez geçiyor`);
      if (signature?.tokens.length) reasons.push(`özgü ifade: ${signature.tokens.slice(0, 4).join(", ")}`);
      if (memory) reasons.push(`${memory} cümle firmanın belleğinde`);
      return {
        clientId,
        score: 3 * Math.min(names, 3) + Math.min(signature?.weight ?? 0, 10) + 2 * Math.min(memory, 15),
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Müşteri dışında adı en çok geçen firma (en az `makerHits` kez): belgedeki ürünün sahibi. */
export function makerFor(names: Map<string, number>, clientId: string | null, rules = DETECTION): string | null {
  if (!clientId) return null;
  const maker = [...names]
    .filter(([id, count]) => id !== clientId && count >= rules.makerHits)
    .sort((a, b) => b[1] - a[1])[0];
  return maker ? maker[0] : null;
}

export function decide(scored: ScoredClient[], names: Map<string, number>, rules = DETECTION): Detection {
  const [top, second] = scored;
  let decision: Detection["decision"] = "ask";
  if (top && top.score >= rules.auto && (!second || top.score >= rules.autoMargin * second.score)) decision = "auto";
  else if (top && top.score >= rules.suggest && (!second || top.score >= rules.suggestMargin * second.score)) decision = "suggest";
  const clientId = decision === "ask" ? null : top.clientId;
  return { decision, clientId, makerId: makerFor(names, clientId, rules), candidates: scored.slice(0, 5) };
}
```

- [ ] **Step 4: Geçtiğini gör** — 6 pass. (İlk testte "BASFİNE" `flat` sonrası "basfine" olur ve kelime sınırı eşleşmez.)

- [ ] **Step 5: `client-detection-store.ts`**

```ts
import { getCeviriSupabase } from "./supabase";
import { listClients } from "./clients";
import { tokensOf } from "./fold";
import { memoryLangs } from "./languages";
import { segmentHash } from "./normalize";
import { decide, makerFor, nameHits, scoreClients, signatureHits, type Detection } from "./detect-client";

/**
 * Belgenin metninden kanıt toplar ve kararı verir. `chosen` verilirse müşteri
 * elle seçilmiştir: karar "manual" olur, üretici yine belgeden bulunur.
 */
export async function detectForDocument(texts: string[], sourceLang: string, chosen: string | null = null): Promise<Detection> {
  const supabase = getCeviriSupabase();
  const clients = await listClients();
  const names = nameHits(texts.join("\n"), clients);

  const tokens = [...new Set(texts.flatMap(tokensOf))];
  const signatureRows: Array<{ client_id: string; token: string; weight: number }> = [];
  for (let i = 0; i < tokens.length; i += 300) {
    const { data, error } = await supabase.from("client_signatures").select("client_id, token, weight").in("token", tokens.slice(i, i + 300));
    if (error) throw new Error(error.message);
    signatureRows.push(...((data ?? []) as typeof signatureRows));
  }

  const long = texts.filter((text) => text.trim().length >= 30);
  const hashes = [...new Set(memoryLangs(sourceLang).flatMap((lang) => long.map((text) => segmentHash(text, lang))))];
  const seen = new Map<string, Set<string>>();
  for (let i = 0; i < hashes.length; i += 200) {
    const { data, error } = await supabase
      .from("tm_segments")
      .select("client_id, source_hash")
      .in("source_hash", hashes.slice(i, i + 200))
      .not("client_id", "is", null);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ client_id: string; source_hash: string }>) {
      const set = seen.get(row.client_id) ?? new Set<string>();
      set.add(row.source_hash);
      seen.set(row.client_id, set);
    }
  }
  const memory = new Map([...seen].map(([id, set]) => [id, set.size]));

  const scored = scoreClients({ names, signature: signatureHits(tokens, signatureRows), memory });
  if (chosen) return { decision: "manual", clientId: chosen, makerId: makerFor(names, chosen), candidates: scored.slice(0, 5) };
  return decide(scored, names);
}
```

- [ ] **Step 6: Yüklemeye bağla** — `app/api/ceviri/documents/route.ts`: import `import { detectForDocument } from "../../../../lib/ceviri/client-detection-store";`. Task 7'deki blok şununla değişir:

```ts
    let clientId: string | null = null;
    let makerId: string | null = null;
    let detection: Record<string, unknown> | null = null;
    if (clientChoice !== "none") {
      try {
        const chosen = clientChoice === "auto" ? null : clientChoice;
        const found = await detectForDocument(parsed.segments.map((segment) => segment.text), sourceLang, chosen);
        clientId = found.clientId;
        makerId = found.makerId;
        detection = { ...found, at: new Date().toISOString() };
      } catch (cause) {
        // Tespit kurulamazsa yükleme bozulmaz: firma sorulur.
        if (clientChoice !== "auto") clientId = clientChoice;
        detection = {
          decision: clientChoice === "auto" ? "ask" : "manual",
          clientId,
          makerId: null,
          candidates: [],
          error: cause instanceof Error ? cause.message : String(cause),
          at: new Date().toISOString(),
        };
      }
    }
```
- [ ] **Step 7: Doğrula** — tsc/eslint; tüm `ceviri-*` testleri; yerel sunucuda NJ BASF mektubunu "Otomatik" ile yükle → belge başlığında "Firma: BASF — otomatik: …".

- [ ] **Step 8: Commit** — `git add lib/ceviri/detect-client.ts lib/ceviri/client-detection-store.ts app/api/ceviri/documents/route.ts tests/ceviri-detect-client.test.ts && git commit -m "Otomatik firma tespiti: ad, parmak izi, bellek"`

---

### Task 15: Tespitin ölçülmesi (kalibrasyon)

**Files:**
- Create: `scripts/ceviri-eval-detection.ts`
- Modify: `package.json` (`ceviri:eval-detection`)

**Interfaces:**
- Consumes: `buildSignatures`, `signatureHits`, `nameHits`, `scoreClients`, `decide`, `DETECTION`, `DEFAULT_ALIASES`, `tokensOf`

- [ ] **Step 1: Betik** — TMX klasörü ve `firma-gruplari.tsv` ile 5 katlı çapraz doğrulama: etiketli projeler 5 parçaya bölünür; her katta 4 parçadan parmak izi ve "firmanın uzun cümleleri" kurulur, 5. parça sınıflandırılır (proje adı kullanılmaz, yalnızca metin).

```ts
/**
 * Firma tespitinin eski arşivde ölçümü (spec 5.2 kabul ölçütü).
 * Usage: npm run ceviri:eval-detection -- <tmx-klasörü> <firma-gruplari.tsv>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildSignatures } from "../lib/ceviri/signatures";
import { decide, nameHits, scoreClients, signatureHits } from "../lib/ceviri/detect-client";
import { tokensOf } from "../lib/ceviri/fold";
import { DEFAULT_ALIASES } from "../lib/ceviri/project-firms";

const [root, labelsPath] = process.argv.slice(2);
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".tmx")) files.push(path);
  }
})(root);

const unescape = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const projects = new Map<string, { sources: Set<string> }>();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/<tu [\s\S]*?<\/tu>/g)) {
    const tu = match[0];
    const pid = /type="x-project_id">([^<]*)</.exec(tu)?.[1] ?? "?";
    const seg = /<seg>([\s\S]*?)<\/seg>/.exec(tu)?.[1];
    if (!seg) continue;
    const project = projects.get(pid) ?? { sources: new Set<string>() };
    project.sources.add(unescape(seg).trim());
    projects.set(pid, project);
  }
}

const labels = new Map<string, string>();
for (const line of readFileSync(labelsPath, "utf8").trim().split("\n").slice(1)) {
  const [firm, , pid] = line.split("\t");
  if (firm !== "genel" && firm !== "?karışık" && projects.has(pid)) labels.set(pid, firm);
}
const clients = Object.entries(DEFAULT_ALIASES).map(([id, preset]) => ({ id, name: preset.name, aliases: preset.aliases }));
const labeled = [...labels.keys()].sort();
const K = 5;
const tally = { auto: 0, autoRight: 0, suggest: 0, suggestRight: 0, ask: 0 };
const confusion = new Map<string, number>();

for (let fold = 0; fold < K; fold++) {
  const test = labeled.filter((_, index) => index % K === fold);
  const train = new Set(labeled.filter((_, index) => index % K !== fold));
  const docs = [...projects].map(([pid, p]) => ({ clientId: train.has(pid) ? labels.get(pid)! : null, texts: [...p.sources] }));
  const signatures = buildSignatures(docs).map((s) => ({ client_id: s.clientId, token: s.token, weight: s.weight }));
  const owner = new Map<string, string>();
  for (const pid of train) {
    for (const sentence of projects.get(pid)!.sources) {
      if (sentence.length < 30) continue;
      const seen = owner.get(sentence);
      owner.set(sentence, seen && seen !== labels.get(pid) ? "*" : labels.get(pid)!);
    }
  }
  for (const pid of test) {
    const texts = [...projects.get(pid)!.sources];
    const names = nameHits(texts.join("\n"), clients);
    const memory = new Map<string, number>();
    for (const sentence of texts) {
      const firm = owner.get(sentence);
      if (firm && firm !== "*") memory.set(firm, (memory.get(firm) ?? 0) + 1);
    }
    const tokens = [...new Set(texts.flatMap(tokensOf))];
    const detection = decide(scoreClients({ names, signature: signatureHits(tokens, signatures), memory }), names);
    const truth = labels.get(pid)!;
    if (detection.decision === "auto") {
      tally.auto++;
      if (detection.clientId === truth) tally.autoRight++;
      else confusion.set(`${truth}→${detection.clientId}`, (confusion.get(`${truth}→${detection.clientId}`) ?? 0) + 1);
    } else if (detection.decision === "suggest") {
      tally.suggest++;
      if (detection.clientId === truth) tally.suggestRight++;
    } else tally.ask++;
  }
}

const total = labeled.length;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
console.log(`Etiketli proje: ${total}`);
console.log(`Otomatik: ${tally.auto} (${pct(tally.auto, total)}), doğruluk ${pct(tally.autoRight, tally.auto)}`);
console.log(`Öneri:    ${tally.suggest} (${pct(tally.suggest, total)}), doğruluk ${pct(tally.suggestRight, tally.suggest)}`);
console.log(`Sor:      ${tally.ask} (${pct(tally.ask, total)})`);
console.log("Otomatik hatalar:", [...confusion].map(([k, v]) => `${k}:${v}`).join(", ") || "yok");
```
`package.json`: `"ceviri:eval-detection": "tsx scripts/ceviri-eval-detection.ts"`.

- [ ] **Step 2: Çalıştır** — `npm run ceviri:eval-detection -- "$SCRATCHPAD/tmx" .claude/firma-tarama/firma-gruplari.tsv`. Kabul: otomatik doğruluk ≥ %95, "sor" ≤ %30.

- [ ] **Step 3: Gerekirse ayarla** — ölçüt tutmazsa yalnızca `DETECTION` eşikleri (`auto`, `autoMargin`) değiştirilir, betik yeniden çalıştırılır; `tests/ceviri-detect-client.test.ts` yeni eşiklerle hâlâ geçmeli (test beklentileri spec davranışını anlatır: BASF mektubu otomatik, Nase müşteri/Syngenta üretici, kanıtsız sor). Son sonuçlar spec'in 5.2 bölümüne "Ölçüm (23 Eylül 2026)" alt başlığıyla yazılır.

- [ ] **Step 4: Commit** — `git add scripts/ceviri-eval-detection.ts package.json docs/superpowers/specs && git commit -m "Firma tespitinin eski arşivde ölçümü"`

---

## FAZ 4 — Öğrenme

### Task 16: Terim çıkarma (`term-mining.ts`) ve öneriler

**Files:**
- Create: `lib/ceviri/term-mining.ts`, `lib/ceviri/suggestion-store.ts`, `app/api/ceviri/clients/[id]/suggestions/route.ts`
- Modify: `app/ceviri-app/firmalar/[slug]/suggestion-panel.tsx`
- Test: `tests/ceviri-term-mining.test.ts`

**Interfaces:**
- Consumes: `localeLower` (`normalize.ts`), `normalizeForMatch`
- Produces: `words(text, lang): string[]`, `stem(word): string`, `logLikelihood(a, b, c, d): number`, `type TermPair = { source: string; target: string }`, `type MinedTerm = { source: string; target: string; g2: number; dice: number; together: number; examples: TermPair[] }`, `MINING`, `mineTerms(firm: TermPair[], reference: string[], langs: { source: string; target: string }, rules?): MinedTerm[]`; `runMining(clientId: string, langs): Promise<{ mined: number; conflicts: number }>`, `listSuggestions(clientId): Promise<Suggestion[]>`, `recordEdit(input): Promise<void>` (Task 17), `decideSuggestion(clientId, id, action, targetText?): Promise<void>`; API `GET` → `{ suggestions }`, `POST {sourceLang,targetLang}` → `{ mined, conflicts }`, `PATCH {id, action: "accept" | "reject", targetText?}` → `{ saved: true }`.

- [ ] **Step 1: Testi yaz**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { logLikelihood, mineTerms, stem } from "../lib/ceviri/term-mining.ts";

test("stems long words to six letters so Turkish suffixes count together", () => {
  assert.equal(stem("ruhsatı"), "ruhsat");
  assert.equal(stem("ruhsatının"), "ruhsat");
  assert.equal(stem("doz"), "doz");
});

test("log-likelihood is zero when the rates match and grows as they differ", () => {
  assert.ok(Math.abs(logLikelihood(10, 100, 100, 1000)) < 1e-9);
  assert.ok(logLikelihood(10, 1, 100, 1000) > 10.83);
});

test("finds the firm's own rendering of a frequent term, not everyday words", () => {
  const firm = [
    { source: "The registration of the product expires.", target: "Ürünün ruhsatı sona erer." },
    { source: "Registration number of the product", target: "Ürünün ruhsat numarası" },
    { source: "The registration holder is responsible.", target: "Ruhsat sahibi sorumludur." },
    { source: "The registration was renewed in 2024.", target: "Ruhsat 2024 yılında yenilendi." },
    { source: "Apply for registration before use.", target: "Kullanmadan önce ruhsat için başvurun." },
    { source: "Keep the product dry.", target: "Ürünü kuru tutun." },
  ];
  const reference = Array.from({ length: 40 }, (_, i) => (i % 2 ? "Keep the product in a dry place." : "The product label must be read."));
  const mined = mineTerms(firm, reference, { source: "en-US", target: "tr-TR" });
  const registration = mined.find((term) => term.source === "registration");
  assert.ok(registration, JSON.stringify(mined.map((m) => m.source)));
  assert.equal(registration.target, "ruhsat");
  assert.ok(registration.dice >= 0.5);
  assert.equal(mined.some((term) => term.source === "product"), false, "the reference corpus uses 'product' as much");
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — FAIL.

- [ ] **Step 3: `term-mining.ts`**

```ts
import { localeLower } from "./normalize";

/**
 * Referans çiftlerinden ve firmanın belleğinden terim çıkarma (spec 5.5).
 *
 * 1. Aday kaynak ifade: firmada sık, genel derlemde nadir 1–4 kelimelik ifade
 *    (Dunning log-olabilirlik, G² ≥ 10,83 → p < 0,001).
 * 2. Karşılık: adayı içeren hizalı cümlelerin hedef tarafındaki ifadeler,
 *    birlikte görülme sıklığına göre Dice katsayısıyla. Türkçe ekler için sayım
 *    kaba kök üzerinden (7+ harfli kelimede ilk 6 harf): "ruhsatı",
 *    "ruhsatının" ve "ruhsat" aynı karşılık sayılır.
 */

export type TermPair = { source: string; target: string };
export type MinedTerm = { source: string; target: string; g2: number; dice: number; together: number; examples: TermPair[] };

export const MINING = { minCount: 3, minG2: 10.83, minDice: 0.5, maxCandidates: 150, maxSourceN: 4, maxTargetN: 5 };

const STOP = new Set(
  (
    "a an the and or of to in on at for from by with as is are was were be been being it its this that these those " +
    "not no into than then there their they he she we you your our his her which who whom whose what when where how " +
    "all any each other such only own same so too very can will shall may must should would could has have had do does " +
    "ve veya ile için bu şu o bir da de ki ya ise gibi daha en çok olan olarak ilgili üzere göre kadar sonra önce her " +
    "der die das und oder mit von zu den dem des ein eine"
  ).split(" "),
);

export function words(text: string, lang: string): string[] {
  return localeLower(text, lang).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

export function stem(word: string): string {
  return word.length >= 7 ? word.slice(0, 6) : word;
}

const usable = (tokens: string[]) =>
  !STOP.has(tokens[0]) && !STOP.has(tokens[tokens.length - 1]) && tokens.some((t) => !/^\d+$/.test(t)) && !(tokens.length === 1 && tokens[0].length < 3);

function grams(tokens: string[], maxN: number): string[] {
  const out = new Set<string>();
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const slice = tokens.slice(i, i + n);
      if (usable(slice)) out.add(slice.join(" "));
    }
  }
  return [...out];
}

/** Dunning G²: firmada a/c, genelde b/d oranı. */
export function logLikelihood(a: number, b: number, c: number, d: number): number {
  const e1 = (c * (a + b)) / (c + d);
  const e2 = (d * (a + b)) / (c + d);
  const term = (observed: number, expected: number) => (observed > 0 && expected > 0 ? observed * Math.log(observed / expected) : 0);
  return 2 * (term(a, e1) + term(b, e2));
}

export function mineTerms(firm: TermPair[], reference: string[], langs: { source: string; target: string }, rules = MINING): MinedTerm[] {
  const sourceGrams = firm.map((pair) => grams(words(pair.source, langs.source), rules.maxSourceN));
  const df = new Map<string, number[]>();
  sourceGrams.forEach((list, index) => {
    for (const gram of list) df.set(gram, [...(df.get(gram) ?? []), index]);
  });

  const refDf = new Map<string, number>();
  for (const text of reference) {
    for (const gram of grams(words(text, langs.source), rules.maxSourceN)) {
      if (df.has(gram)) refDf.set(gram, (refDf.get(gram) ?? 0) + 1);
    }
  }

  let candidates = [...df]
    .filter(([, rows]) => rows.length >= rules.minCount)
    .map(([gram, rows]) => {
      const a = rows.length;
      const b = refDf.get(gram) ?? 0;
      return { gram, rows, g2: a / firm.length > b / Math.max(reference.length, 1) ? logLikelihood(a, b, firm.length, Math.max(reference.length, 1)) : 0 };
    })
    .filter((candidate) => candidate.g2 >= rules.minG2);

  // Alt ifade, kendisini içeren daha uzun ifadeyle hemen hep birlikte geçiyorsa atılır.
  candidates = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.gram !== candidate.gram &&
          ` ${other.gram} `.includes(` ${candidate.gram} `) &&
          other.rows.length >= 0.9 * candidate.rows.length,
      ),
  );
  candidates = candidates.sort((a, b) => b.g2 - a.g2).slice(0, rules.maxCandidates);

  const targetStems = firm.map((pair) => {
    const surface = words(pair.target, langs.target);
    const stems = surface.map(stem);
    const out = new Map<string, string>();
    for (let n = 1; n <= rules.maxTargetN; n++) {
      for (let i = 0; i + n <= stems.length; i++) {
        const slice = surface.slice(i, i + n);
        if (!usable(slice)) continue;
        const key = stems.slice(i, i + n).join(" ");
        if (!out.has(key)) out.set(key, slice.join(" "));
      }
    }
    return out;
  });
  const targetDf = new Map<string, number>();
  for (const map of targetStems) for (const key of map.keys()) targetDf.set(key, (targetDf.get(key) ?? 0) + 1);

  const mined: MinedTerm[] = [];
  for (const candidate of candidates) {
    const together = new Map<string, number>();
    const surfaces = new Map<string, Map<string, number>>();
    for (const index of candidate.rows) {
      for (const [key, surface] of targetStems[index]) {
        together.set(key, (together.get(key) ?? 0) + 1);
        const forms = surfaces.get(key) ?? new Map<string, number>();
        forms.set(surface, (forms.get(surface) ?? 0) + 1);
        surfaces.set(key, forms);
      }
    }
    let best: { key: string; dice: number; together: number } | null = null;
    for (const [key, count] of together) {
      if (count < rules.minCount) continue;
      const dice = (2 * count) / (candidate.rows.length + (targetDf.get(key) ?? 0));
      if (dice < rules.minDice) continue;
      if (!best || dice > best.dice || (dice === best.dice && key.split(" ").length < best.key.split(" ").length)) best = { key, dice, together: count };
    }
    if (!best) continue;
    const forms = [...surfaces.get(best.key)!].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
    const exact = forms.find(([form]) => form === best!.key);
    mined.push({
      source: candidate.gram,
      target: exact ? exact[0] : forms[0][0],
      g2: candidate.g2,
      dice: best.dice,
      together: best.together,
      examples: candidate.rows.slice(0, 3).map((index) => firm[index]),
    });
  }
  return mined.sort((a, b) => b.g2 * b.dice - a.g2 * a.dice);
}
```
Not: "ruhsat" yüzey biçimi, kök anahtarıyla birebir aynı olduğu için tercih edilir (`exact`); böylece öneri sözlük biçiminde gelir.

- [ ] **Step 4: Geçtiğini gör** — 3 pass.

- [ ] **Step 5: `suggestion-store.ts`**

```ts
import { getCeviriSupabase } from "./supabase";
import { normalizeForMatch } from "./normalize";
import { mineTerms, type TermPair } from "./term-mining";

export type Suggestion = {
  id: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  kind: "extracted" | "edit" | "conflict";
  score: number;
  evidence: Array<{ source: string; target: string; from?: string; document?: string }>;
  status: string;
};

/** Firma belleğinden terim çıkarır; genel terimceyle çelişenler "firma farkı" olur. */
export async function runMining(clientId: string, langs: { source: string; target: string }): Promise<{ mined: number; conflicts: number }> {
  const supabase = getCeviriSupabase();
  const { data: own, error } = await supabase
    .from("tm_segments")
    .select("source_text, target_text")
    .eq("client_id", clientId)
    .eq("source_lang", langs.source)
    .eq("target_lang", langs.target)
    .limit(20000);
  if (error) throw new Error(error.message);
  const { data: general, error: generalError } = await supabase
    .from("tm_segments")
    .select("source_text")
    .is("client_id", null)
    .eq("source_lang", langs.source)
    .limit(20000);
  if (generalError) throw new Error(generalError.message);

  const firm: TermPair[] = ((own ?? []) as Array<{ source_text: string; target_text: string }>).map((row) => ({ source: row.source_text, target: row.target_text }));
  const mined = mineTerms(firm, ((general ?? []) as Array<{ source_text: string }>).map((row) => row.source_text), langs);

  let conflicts = 0;
  const rows = [];
  for (const term of mined) {
    const { data: hits } = await supabase.rpc("lookup_terms_scoped", {
      p_text: normalizeForMatch(term.source, langs.source),
      p_source_lang: langs.source,
      p_target_lang: langs.target,
      p_client_ids: [],
      p_sector_id: null,
    });
    const generalTargets = ((hits ?? []) as Array<{ source_text: string; target_text: string; is_forbidden: boolean }>)
      .filter((hit) => !hit.is_forbidden && normalizeForMatch(hit.source_text, langs.source) === normalizeForMatch(term.source, langs.source))
      .map((hit) => normalizeForMatch(hit.target_text, langs.target));
    if (generalTargets.includes(normalizeForMatch(term.target, langs.target))) continue; // genel terimce zaten aynı
    const kind = generalTargets.length ? "conflict" : "extracted";
    if (kind === "conflict") conflicts += 1;
    rows.push({
      client_id: clientId,
      source_lang: langs.source,
      target_lang: langs.target,
      source_text: term.source,
      target_text: term.target,
      kind,
      score: Number((term.g2 * term.dice).toFixed(2)),
      evidence: term.examples,
    });
  }
  if (rows.length) {
    const { error: upsertError } = await supabase
      .from("term_suggestions")
      .upsert(rows, { onConflict: "client_id,source_lang,target_lang,source_text,target_text", ignoreDuplicates: true });
    if (upsertError) throw new Error(upsertError.message);
  }
  return { mined: rows.length, conflicts };
}

/** Bekleyen öneriler; düzeltme gözlemleri ancak ikinci kez görülünce listelenir (spec 5.6). */
export async function listSuggestions(clientId: string): Promise<Suggestion[]> {
  const { data, error } = await getCeviriSupabase()
    .from("term_suggestions")
    .select("id, source_lang, target_lang, source_text, target_text, kind, score, evidence, status")
    .eq("client_id", clientId)
    .eq("status", "pending")
    .order("score", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Suggestion[]).filter((s) => s.kind !== "edit" || s.evidence.length >= 2);
}

export async function decideSuggestion(clientId: string, id: string, action: "accept" | "reject", targetText?: string): Promise<void> {
  const supabase = getCeviriSupabase();
  const { data: suggestion, error } = await supabase
    .from("term_suggestions")
    .select("id, source_lang, target_lang, source_text, target_text")
    .eq("id", id)
    .eq("client_id", clientId)
    .single();
  if (error) throw new Error(error.message);
  if (action === "accept") {
    const target = targetText?.trim() || suggestion.target_text;
    const { data: concept, error: conceptError } = await supabase
      .from("term_concepts")
      .insert({ scope_type: "client", scope_id: clientId, definition: "Öğrenilen terim" })
      .select("id")
      .single();
    if (conceptError) throw new Error(conceptError.message);
    const { error: variantError } = await supabase.from("term_variants").insert([
      { concept_id: concept.id, lang: suggestion.source_lang, text: suggestion.source_text, normalized: normalizeForMatch(suggestion.source_text, suggestion.source_lang), is_preferred: true, is_forbidden: false },
      { concept_id: concept.id, lang: suggestion.target_lang, text: target, normalized: normalizeForMatch(target, suggestion.target_lang), is_preferred: true, is_forbidden: false },
    ]);
    if (variantError) throw new Error(variantError.message);
  }
  const { error: statusError } = await supabase.from("term_suggestions").update({ status: action === "accept" ? "accepted" : "rejected" }).eq("id", id);
  if (statusError) throw new Error(statusError.message);
}
```

- [ ] **Step 6: `suggestions/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getClient } from "../../../../../../lib/ceviri/clients";
import { decideSuggestion, listSuggestions, runMining } from "../../../../../../lib/ceviri/suggestion-store";

export const runtime = "nodejs";
export const maxDuration = 300;

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    return NextResponse.json({ suggestions: await listSuggestions(client.id) });
  } catch (error) {
    return failure(error, "Öneriler okunamadı.");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { sourceLang?: string; targetLang?: string };
    return NextResponse.json(await runMining(client.id, { source: body.sourceLang ?? "en-US", target: body.targetLang ?? "tr-TR" }));
  } catch (error) {
    return failure(error, "Terim çıkarılamadı.");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const body = (await request.json().catch(() => null)) as { id?: string; action?: string; targetText?: string } | null;
    if (!body?.id || (body.action !== "accept" && body.action !== "reject")) {
      return NextResponse.json({ error: "id ve action (accept|reject) gerekli." }, { status: 400 });
    }
    await decideSuggestion(client.id, body.id, body.action, body.targetText);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return failure(error, "Öneri kaydedilemedi.");
  }
}
```

- [ ] **Step 7: `suggestion-panel.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../lingua.module.css";
import firms from "../../firms.module.css";
import { LANGS, readJson, type FirmClient } from "./firm";

type Suggestion = {
  id: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  kind: "extracted" | "edit" | "conflict";
  score: number;
  evidence: Array<{ source: string; target: string; from?: string }>;
};

const KIND: Record<Suggestion["kind"], string> = { conflict: "FİRMA FARKI", extracted: "ÇIKARILDI", edit: "DÜZELTMEDEN" };

export default function SuggestionPanel({ client, onChange }: { client: FirmClient; onChange: () => void }) {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [langs, setLangs] = useState({ source: "en-US", target: "tr-TR" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await readJson(await fetch(`/api/ceviri/clients/${client.id}/suggestions`), "Öneriler okunamadı.");
      setList(payload.suggestions as Suggestion[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Öneriler okunamadı.");
    }
  }, [client.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mine() {
    setBusy(true);
    setError(null);
    setMessage("Firmanın belleği taranıyor…");
    try {
      const payload = await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceLang: langs.source, targetLang: langs.target }),
        }),
        "Terim çıkarılamadı.",
      );
      setMessage(`${payload.mined} yeni öneri; ${payload.conflicts} tanesi genel terimceden farklı.`);
      await load();
      onChange();
    } catch (cause) {
      setMessage(null);
      setError(cause instanceof Error ? cause.message : "Terim çıkarılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(item: Suggestion, action: "accept" | "reject") {
    try {
      await readJson(
        await fetch(`/api/ceviri/clients/${client.id}/suggestions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, action, targetText: edits[item.id] ?? item.target_text }),
        }),
        "Öneri kaydedilemedi.",
      );
      setList((current) => current?.filter((s) => s.id !== item.id) ?? null);
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Öneri kaydedilemedi.");
    }
  }

  return (
    <>
      <div className={firms.panel}>
        <p className={firms.panelTitle}>Terim çıkar</p>
        <p className={firms.muted}>
          {client.name} belleğinde sık geçen ama genel bellekte nadir olan ifadeler ve firmanın bunları nasıl çevirdiği bulunur.
          Genel terimceden farklı çevrilenler &quot;firma farkı&quot; olarak işaretlenir.
        </p>
        <div className={firms.row} style={{ borderTop: 0 }}>
          <select className={firms.select} value={langs.source} onChange={(e) => setLangs({ ...langs, source: e.target.value })}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
          <span>→</span>
          <select className={firms.select} value={langs.target} onChange={(e) => setLangs({ ...langs, target: e.target.value })}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => void mine()}>Terim çıkar</button>
          {message && <span className={firms.ok}>{message}</span>}
        </div>
      </div>
      {error && <div className={styles.err}>{error}</div>}
      <div className={firms.panel}>
        {list === null && <span className={firms.muted}>yükleniyor…</span>}
        {list?.length === 0 && <span className={firms.muted}>Bekleyen öneri yok.</span>}
        {list?.map((item) => (
          <div className={firms.row} key={item.id}>
            <span className={`${firms.badge} ${item.kind === "conflict" ? firms.badgeRed : firms.badgeGreen}`}>{KIND[item.kind]}</span>
            <b>{item.source_text}</b>
            <span>→</span>
            <input className={firms.input} value={edits[item.id] ?? item.target_text} onChange={(e) => setEdits({ ...edits, [item.id]: e.target.value })} />
            <span className={`${firms.muted} ${firms.grow}`} title={item.evidence.map((e) => `${e.source} → ${e.target}`).join("\n")}>
              {item.evidence[0] ? `ör. “${item.evidence[0].target}”` : ""}
              {item.kind === "edit" ? ` · ${item.evidence.length} düzeltme` : ""}
            </span>
            <button className={styles.primary} type="button" onClick={() => void decide(item, "accept")}>Terimceye ekle</button>
            <button className={styles.secondary} type="button" onClick={() => void decide(item, "reject")}>Reddet</button>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 8: Doğrula** — testler, tsc/eslint; yerel sunucuda Syngenta için "Terim çıkar" → öneri sayısı > 0, bir öneri kabul edilince firmanın terimcesinde görünür.

- [ ] **Step 9: Commit** — `git add lib/ceviri/term-mining.ts lib/ceviri/suggestion-store.ts app/api/ceviri/clients app/ceviri-app/firmalar tests/ceviri-term-mining.test.ts && git commit -m "Firma belleğinden terim çıkarma ve öneri ekranı"`

---

### Task 17: Düzeltmeden öğrenme (`edit-learning.ts`)

**Files:**
- Create: `lib/ceviri/edit-learning.ts`
- Modify: `lib/ceviri/suggestion-store.ts` (`recordEdit`), `app/api/ceviri/documents/[id]/segments/route.ts`
- Test: `tests/ceviri-edit-learning.test.ts`

**Interfaces:**
- Consumes: `stem` (Task 16), `fold` (Task 2); segmentlerde saklanan `terms` (Task 7)
- Produces: `diffWords(a: string, b: string): Array<{ op: "same" | "del" | "ins"; text: string }>`, `replacedSpans(before: string, after: string): Array<{ from: string; to: string }>`, `type EditObservation = { sourceTerm: string; from: string; to: string }`, `observeEdits(input: { source: string; before: string; after: string; terms: Array<{ sourceText: string; targetText: string }> }): EditObservation[]`; `recordEdit(input: { clientId: string; sourceLang: string; targetLang: string; observation: EditObservation; source: string; after: string; documentId: string }): Promise<void>`.

- [ ] **Step 1: Testi yaz**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { diffWords, observeEdits, replacedSpans } from "../lib/ceviri/edit-learning.ts";

test("word diff keeps the common words and marks the rest", () => {
  const ops = diffWords("Tescil sahibi BASF'tir.", "Ruhsat sahibi BASF'tir.");
  assert.deepEqual(ops.map((o) => o.op), ["del", "ins", "same", "same"]);
});

test("replaced spans pair deletions with the insertions that follow them", () => {
  assert.deepEqual(replacedSpans("Ürünün tescil numarası 123", "Ürünün ruhsat numarası 123"), [{ from: "tescil", to: "ruhsat" }]);
  assert.deepEqual(replacedSpans("A B C", "A B C D"), [], "pure insertion is not a replacement");
});

test("a required term the reviewer replaced becomes an observation", () => {
  const observations = observeEdits({
    source: "The registration holder is BASF.",
    before: "Tescil sahibi BASF'tir.",
    after: "Ruhsat sahibi BASF'tir.",
    terms: [{ sourceText: "registration", targetText: "tescil" }],
  });
  assert.deepEqual(observations, [{ sourceTerm: "registration", from: "tescil", to: "Ruhsat" }]);
});

test("the inflected form of the term still counts; unrelated edits do not", () => {
  assert.deepEqual(
    observeEdits({
      source: "Renew the registration.",
      before: "Tescili yenileyin.",
      after: "Ruhsatı yenileyin.",
      terms: [{ sourceText: "registration", targetText: "tescil" }],
    }),
    [{ sourceTerm: "registration", from: "tescil", to: "Ruhsatı" }],
  );
  assert.deepEqual(
    observeEdits({ source: "Keep dry.", before: "Kuru tutun.", after: "Kuru yerde tutun.", terms: [{ sourceText: "registration", targetText: "tescil" }] }),
    [],
  );
});
```

- [ ] **Step 2: Başarısız olduğunu gör** — FAIL.

- [ ] **Step 3: Uygula**

```ts
import { fold } from "./fold";
import { stem } from "./term-mining";

/**
 * İnceleme ekranındaki düzeltmeden öğrenme (spec 5.6). Makine çevirisi ile
 * çevirmenin son hâli kelime düzeyinde karşılaştırılır; değişen aralık,
 * cümlede zorunlu tutulan bir terimin karşılığıysa "(terim → yeni karşılık)"
 * gözlemi çıkar. Aynı gözlem bir firmada ikinci kez görülünce öneri olur.
 */

export type WordOp = { op: "same" | "del" | "ins"; text: string };
export type EditObservation = { sourceTerm: string; from: string; to: string };

const bare = (word: string) => fold(word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** En uzun ortak altdiziyle kelime farkı; noktalama ve büyük/küçük harf karşılaştırmada yok sayılır. */
export function diffWords(a: string, b: string): WordOp[] {
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = bare(x[i]) === bare(y[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: WordOp[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (bare(x[i]) === bare(y[j])) {
      ops.push({ op: "same", text: y[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ op: "del", text: x[i++] });
    else ops.push({ op: "ins", text: y[j++] });
  }
  while (i < x.length) ops.push({ op: "del", text: x[i++] });
  while (j < y.length) ops.push({ op: "ins", text: y[j++] });
  return ops;
}

export function replacedSpans(before: string, after: string): Array<{ from: string; to: string }> {
  const spans: Array<{ from: string; to: string }> = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length && added.length) {
      spans.push({ from: removed.map(bare).join(" "), to: added.join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") });
    }
    removed = [];
    added = [];
  };
  for (const op of diffWords(before, after)) {
    if (op.op === "same") flush();
    else if (op.op === "del") removed.push(op.text);
    else added.push(op.text);
  }
  flush();
  return spans;
}

export function observeEdits(input: {
  source: string;
  before: string;
  after: string;
  terms: Array<{ sourceText: string; targetText: string }>;
}): EditObservation[] {
  const source = ` ${fold(input.source).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const observations: EditObservation[] = [];
  for (const span of replacedSpans(input.before, input.after)) {
    const fromStems = span.from.split(" ").map(stem);
    for (const term of input.terms) {
      const sourceTerm = fold(term.sourceText).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!source.includes(` ${sourceTerm} `)) continue;
      const termStems = fold(term.targetText).split(/\s+/).map(stem);
      if (!termStems.every((s) => fromStems.includes(s))) continue;
      observations.push({ sourceTerm: term.sourceText, from: term.targetText, to: span.to });
    }
  }
  return observations;
}
```

- [ ] **Step 4: Geçtiğini gör** — 4 pass.

- [ ] **Step 5: `recordEdit`** — `suggestion-store.ts` sonuna:

```ts
/** Düzeltme gözlemini firmanın öneri kaydına ekler; aynı gözlem kanıt olarak birikir. */
export async function recordEdit(input: {
  clientId: string;
  sourceLang: string;
  targetLang: string;
  observation: { sourceTerm: string; from: string; to: string };
  source: string;
  after: string;
  documentId: string;
}): Promise<void> {
  const supabase = getCeviriSupabase();
  const key = {
    client_id: input.clientId,
    source_lang: input.sourceLang,
    target_lang: input.targetLang,
    source_text: input.observation.sourceTerm,
    target_text: input.observation.to,
  };
  const { data: existing } = await supabase
    .from("term_suggestions")
    .select("id, evidence, status")
    .match(key)
    .maybeSingle();
  const evidence = { source: input.source, target: input.after, from: input.observation.from, document: input.documentId };
  if (existing) {
    if (existing.status !== "pending") return;
    const list = existing.evidence as Array<{ document?: string; source?: string }>;
    if (list.some((e) => e.document === input.documentId && e.source === input.source)) return;
    await supabase.from("term_suggestions").update({ evidence: [...list, evidence], score: list.length + 1 }).eq("id", existing.id);
  } else {
    await supabase.from("term_suggestions").insert({ ...key, kind: "edit", score: 1, evidence: [evidence] });
  }
}
```

- [ ] **Step 6: `segments/route.ts`** — select'e `client_id` ekle; `StoredSegment`'e `terms?: Array<{ sourceText: string; targetText: string }>;`. `upsert_tm_segments` çağrısında `client_id: (doc as { client_id?: string | null }).client_id ?? null,`. Belleğe yazımdan sonra:

```ts
    // Düzeltmeden öğrenme: zorunlu terimin karşılığı değiştirildiyse firmaya gözlem.
    const clientId = (doc as { client_id?: string | null }).client_id ?? null;
    if (clientId && target.translation && target.terms?.length) {
      const observations = observeEdits({ source: target.text, before: target.translation, after: translation, terms: target.terms });
      for (const observation of observations) {
        await recordEdit({ clientId, sourceLang: doc.source_lang, targetLang: doc.target_lang, observation, source: target.text, after: translation, documentId: id }).catch(() => undefined);
      }
    }
```
Importlar: `import { observeEdits } from "../../../../../../lib/ceviri/edit-learning";` ve `import { recordEdit } from "../../../../../../lib/ceviri/suggestion-store";`.

- [ ] **Step 7: Doğrula** — testler, tsc/eslint.

- [ ] **Step 8: Commit** — `git add lib/ceviri/edit-learning.ts lib/ceviri/suggestion-store.ts "app/api/ceviri/documents/[id]/segments/route.ts" tests/ceviri-edit-learning.test.ts && git commit -m "Düzeltmeden öğrenme: terimin yeni karşılığı firmaya öneri olur"`

---

### Task 18: Bütün doğrulama

- [ ] **Step 1: Testler** — `node --import tsx --test tests/ceviri-*.test.ts` → hepsi pass; sayı raporlanır.
- [ ] **Step 2: Tip ve lint** — `npx tsc --noEmit -p . 2>&1 | grep -E "lib/ceviri|app/api/ceviri|app/ceviri-app|scripts/ceviri"` boş; `npx eslint lib/ceviri app/api/ceviri app/ceviri-app scripts` temiz.
- [ ] **Step 3: Veritabanı** — `select * from client_library_stats();` firmaların sayıları; `select count(*) from project_clients where pending;`; `select count(*) from client_signatures;`.
- [ ] **Step 4: Uçtan uca (yerel sunucu, gerçek veritabanı ve API'ler)** — (a) NJ BASF mektubu "Otomatik" ile yüklenir → Firma BASF, gerekçe görünür; (b) bir Nase belgesi (`nase iş.zip` içinden PDF) → müşteri Nase, üretici Syngenta beklenir; (c) çeviri başlatılır, bir satırdaki terim düzeltilir → BASF belleğinde `human-approved` satırı `client_id = basf`; (d) firma değiştirilip yeniden çevrilir → düzeltilmiş satır korunur. Sonuçlar ekran görüntüsüyle raporlanır; sapma varsa ilgili görevin testine gerçek durumu yansıtan bir test eklenip düzeltilir.
- [ ] **Step 5: Spec'i güncelle** — 5.2 "Ölçüm" alt başlığı (Task 15 sonuçları) ve gerçekleşen sayılar (bölüm 2 tablosuna "dağıtımdan sonra" sütunu).
