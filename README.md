# TTAA Content Studio

Local content-production interface for Turkish Translation & Attestation Agency.

## Current capabilities

- Secure admin login with a server-side bcrypt password hash and signed HTTP-only session cookie
- Private staged workflow: brief → official-source research → hidden AI writer → hidden AI editor → final package
- OpenAI Responses API integration using the configured GPT-5.5 snapshot
- Direct server-side OpenAI Image API integration with two parallel `gpt-image-2` generations per article
- TTAA Visual Generation Master Prompt rules: white/blue banner system, quiet left copy area, service-specific right-side document cluster, subtle world map and gradient waves
- Every image is generated through the Image Edits endpoint with the real TTAA logo supplied as a high-fidelity reference, an enforced top-left placement instruction and the exact article headline supplied verbatim
- Hosted web search restricted to the topic-matched official domains in the source inventory
- Strict JSON Schema output for consistent headings, TL;DR, sections, FAQs, one focus keyword, 3-5 secondary keyphrases, SEO metadata, slug and image prompt
- Title-derived Topic Lock that identifies the central subject, language pair, formal process, document type, dominant intent and next action without displaying the analysis
- Enforced primary-topic coverage, controlled topic drift, dynamic section structure and up to two targeted automatic repair passes when deterministic quality checks need correction
- Failed new runs hide the previous WordPress media package so an old visual cannot be mistaken for the newly requested TTAA style
- Dynamic 7-10 question FAQ module with customer-intent, TTAA-presence, topic-specificity, conversion, answer-length and formal-topic drift checks
- Title-only generation with optional primary keyword, country, audience, document/service type and desired word count controls
- Bidirectional language-pair H1 rules, H2/H3, TL;DR, visible breadcrumb, FAQ, contextual internal/external links and structured data
- Separate SEO Head output for `<title>`, meta description, canonical and robots directives
- WordPress-ready semantic article HTML with one shared, cacheable stylesheet; if the WordPress plugin stylesheet is missing or returns 404, the finalizer embeds the same scoped CSS into that draft as a verified fallback
- AIOSEO title, description, canonical, Focus Keyphrase and Additional Keyphrases write-back followed by authenticated REST read-back; the native keyphrase endpoint is used automatically when post-meta writing does not preserve keyphrases
- Schema ownership rules: AIOSEO owns Article/Breadcrumb markup; TTAA embeds matching FAQ markup only, avoiding duplicate Article schema
- Live WordPress content search plus a curated library of verified official sources
- Contextual internal/external links inserted into relevant sentences, with a visible source audit
- Automatic WordPress REST API transfer after generation, locked to `draft`
- Featured and inline WebP images uploaded to WordPress Media Library with semantic alt text and responsive `<figure>` markup
- Topic-specific WhatsApp conversion links for document-review anchors and the final CTA
- Private Supabase Storage archive of each completed content package, WordPress reference and generated-image backup
- Minimal Turkish-language studio interface with one beginner-friendly primary flow, collapsed advanced controls, a clean empty state, responsive preview, SEO, code and integration views
- Authenticated company switcher with isolated TTAA and Ay Tercüme workspaces; Ay Tercüme has its own Turkish writer/editor/repair pipeline, link inventory, topic-lock rules, two-image visual pipeline, real logo reference, local cache and responsive `ayc-` article theme in mint `#43cc9b`, blue `#009fe4`, dark `#0f0b08` and white

## Ay Tercüme workflow

The `/ay-tercume` workspace generates a complete Turkish article, visual and WordPress draft package. It performs official-source research, hidden writing and editing, up to two targeted repairs, deterministic focus-keyword/repetition/FAQ gates, and then generates one featured and one inline image in parallel. The supplied Ay Tercüme logo is passed to the Image Edits endpoint and locked to the top-left; output uses the separate Ay palette and media metadata. Both images are uploaded to the Ay Media Library, the featured image is assigned, the inline image is injected as a semantic figure, and the post is verified as `draft`. The expanded manuals are stored at `prompts/AY_Tercume_SEO_Content_Agent.md` and `prompts/AY_Tercume_Image_Generation_Prompt_Style.md`.

Ay Tercüme uses only `AY_*` integration variables. Its WordPress credentials are configured separately from TTAA. The connected site currently exposes Rank Math, so title, description, canonical, the single focus keyword and secondary variations are written through Rank Math's authenticated metadata endpoint. Until the separate WhatsApp number and storage configuration are supplied, CTA links safely fall back to the Ay contact page and no Ay Supabase backup is attempted.

## Local use

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Copy `.env.example` to `.env.local` and add the required server credentials before signing in.

The local studio runs a real two-pass OpenAI content pipeline. The first pass searches topic-matched official domains and writes the long-form article. The second pass performs editorial, factual-risk, link-anchor and SEO review. Only the edited structured result is assembled into WordPress-safe HTML, JSON-LD and the final draft package.

The Topic Lock keeps language-pair, document-specific and formal-process pages focused on the exact title. Speed-related words affect one relevant section instead of turning the article into a generic urgent-document checklist. Articles that report a failed topic-match, coverage, drift, intent, repetition or legal-safety audit receive up to two targeted hidden repair passes before the package can continue.

When **Primary keyword** is filled in, that exact value becomes the single focus keyword. When it is blank, the model selects one from the title and dominant search intent. A deterministic gate checks the H1/first H2, opening paragraph, 50-60 character SEO title, 120-160 character meta description, short keyword-focused slug, secondary-keyphrase uniqueness and exact-match heading limits before images or a WordPress draft can be created.

Malformed escaped characters in model or integration JSON are repaired defensively. An unreadable OpenAI image response is retried twice, and finalization errors include their exact pipeline phase so the UI only offers a safe retry when no uncertain WordPress draft may have been created.

Generation is intentionally slower than the old deterministic preview because official-source search, long-form writing, editorial review and two parallel image generations are separate model operations. The result stays hidden until both images are in WordPress Media Library and the post exists as a draft. Supabase image-backup failure is reported as a warning, while OpenAI image or WordPress media failure blocks draft creation.

## One-time WordPress style installation

Install the generated **TTAA Content Studio Styles** plugin once in WordPress Admin (`Plugins > Add New > Upload Plugin`). It enqueues `translation-article.css` only for TTAA article posts. The Integrations screen checks the live stylesheet URL and reports whether the plugin is ready.

The article body deliberately does not contain `<title>`, meta description or canonical tags because those belong in the document `<head>`. The studio shows them in the SEO Head tab and writes the final values to AIOSEO after WordPress assigns the draft URL. Hreflang tags are not fabricated; add them only when verified alternate-language URLs exist.

## Security

- `.env.local` is ignored by Git and must never be committed or included in a source archive.
- WordPress, Supabase service-role, OpenAI and session secrets are only read in server modules.
- The OpenAI API key is never sent to browser JavaScript.
- The browser receives integration health/status information, never secret values.
- WordPress post status is set and verified as `draft` on the server.

See `SUPABASE_INTEGRATION.md` for the active image and persistence flow.
