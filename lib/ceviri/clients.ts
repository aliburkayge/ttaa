import { getCeviriSupabase } from "./supabase";
import { fold } from "./fold";
import { normalizeForMatch } from "./normalize";
import type { ScopeChain } from "./scope";

/**
 * Firmalar (spec 3): işi getiren müşteri ya da belgede ürünü geçen üretici.
 * İkisi aynı tabloda; bir firma bir belgede müşteri, başka birinde üretici
 * olabilir.
 */
export type Client = {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  instructions: string | null;
  default_sector_id: string | null;
  notes: string | null;
  /** Adın müşteri göstergesi olarak güvenilirliği (0–1), bellekten öğrenilir. */
  name_weight: number;
};

const COLUMNS = "id, name, slug, aliases, instructions, default_sector_id, notes, name_weight";

const ASCII: Record<string, string> = { ç: "c", ğ: "g", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

export function slugify(name: string): string {
  return fold(name)
    .replace(/[çğöşüâîû]/g, (letter) => ASCII[letter] ?? letter)
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
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

/** Firmanın terimcesine terim: kaynak ve hedef karşılık; `forbidden` ise hedef yasaklı karşılıktır. */
export async function addClientTerm(
  clientId: string,
  term: { sourceLang: string; targetLang: string; sourceText: string; targetText: string; forbidden?: boolean },
): Promise<string> {
  const supabase = getCeviriSupabase();
  const { data: concept, error } = await supabase.from("term_concepts").insert({ scope_type: "client", scope_id: clientId }).select("id").single();
  if (error) throw new Error(error.message);
  const forbidden = term.forbidden === true;
  const { error: variantError } = await supabase.from("term_variants").insert([
    {
      concept_id: concept.id,
      lang: term.sourceLang,
      text: term.sourceText,
      normalized: normalizeForMatch(term.sourceText, term.sourceLang),
      is_preferred: true,
      is_forbidden: false,
    },
    {
      concept_id: concept.id,
      lang: term.targetLang,
      text: term.targetText,
      normalized: normalizeForMatch(term.targetText, term.targetLang),
      is_preferred: !forbidden,
      is_forbidden: forbidden,
    },
  ]);
  if (variantError) {
    await supabase.from("term_concepts").delete().eq("id", concept.id);
    throw new Error(variantError.message);
  }
  return concept.id as string;
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
  const client = doc.client_id ? (byId.get(doc.client_id) ?? null) : null;
  const maker = doc.maker_id ? (byId.get(doc.maker_id) ?? null) : null;
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
