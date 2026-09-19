export type TmxUnit = {
  sourceLang: string;
  targetLang: string;
  sourceText: string;
  targetText: string;
  projectName: string | null;
  contextPre: string | null;
  contextPost: string | null;
  origin: string | null;
};

/** Why a `<tu>` block was skipped instead of yielded. */
export type TmxSkipReason = "too-few-variants" | "no-distinct-target" | "unterminated-unit";

export type TmxParseOptions = { onSkip?: (reason: TmxSkipReason) => void };

/**
 * A single translation unit is a sentence or paragraph — this limit is
 * enormously generous. It exists only to bound memory when a `<tu>` is
 * truncated or malformed and its closing `</tu>` never arrives.
 */
export const TMX_MAX_UNIT_BYTES = 4 * 1024 * 1024;

/** Number of trailing characters kept when no unit opening is in view.
 * `"<tu "` / `"<tu>"` are 4 characters; 8 is a safe margin so a split
 * across a chunk boundary is still detectable in the next chunk. */
const TAIL_KEEP_CHARS = 8;

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

/** Text content of a <seg>, with inline formatting tags removed. */
export function segText(segXml: string): string {
  const inner = segXml.replace(/^[\s\S]*?<seg[^>]*>/, "").replace(/<\/seg>[\s\S]*$/, "");
  return decodeEntities(inner.replace(/<[^>]+>/g, ""));
}

function prop(tuXml: string, type: string): string | null {
  const pattern = new RegExp(`<prop[^>]*type="${type}"[^>]*>([\\s\\S]*?)</prop>`, "i");
  const match = tuXml.match(pattern);
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, "")) : null;
}

function parseUnit(tuXml: string, fallbackSourceLang: string): TmxUnit | TmxSkipReason {
  const tuvs = tuXml.match(/<tuv\b[\s\S]*?<\/tuv>/g) ?? [];
  if (tuvs.length < 2) return "too-few-variants";

  const langOf = (tuv: string) => (tuv.match(/xml:lang="([^"]*)"/) ?? tuv.match(/lang="([^"]*)"/) ?? [])[1] ?? "";
  const declared = (tuXml.match(/<tu\b[^>]*\bsrclang="([^"]*)"/) ?? [])[1] ?? fallbackSourceLang;

  const sourceIndex = tuvs.findIndex((tuv) => langOf(tuv) === declared);
  const srcIndex = sourceIndex === -1 ? 0 : sourceIndex;
  const sourceTuv = tuvs[srcIndex];
  const targetIndex = tuvs.findIndex((_, i) => i !== srcIndex);
  if (targetIndex === -1) return "no-distinct-target";
  const targetTuv = tuvs[targetIndex];

  return {
    sourceLang: langOf(sourceTuv),
    targetLang: langOf(targetTuv),
    sourceText: segText(sourceTuv),
    targetText: segText(targetTuv),
    projectName: prop(tuXml, "x-project_name"),
    contextPre: prop(tuXml, "x-context-pre"),
    contextPost: prop(tuXml, "x-context-post"),
    origin: prop(tuXml, "X-Lara-Engine-Translation-Origin"),
  };
}

/**
 * Streams <tu> units out of TMX text chunks without holding the whole file.
 *
 * Only "<tu " and "<tu>" open a unit. Searching for the bare prefix "<tu"
 * would also hit "<tuv", which opens a language variant INSIDE a unit —
 * trimming the buffer there would cut the unit's own opening tag away.
 */
export async function* parseTmxUnits(
  chunks: AsyncIterable<string>,
  fallbackSourceLang = "",
  options: TmxParseOptions = {},
): AsyncGenerator<TmxUnit> {
  let buffer = "";
  let headerLang = fallbackSourceLang;
  let sawHeader = false;

  const unitOpening = () => {
    const spaced = buffer.indexOf("<tu ");
    const bare = buffer.indexOf("<tu>");
    if (spaced === -1) return bare;
    if (bare === -1) return spaced;
    return Math.min(spaced, bare);
  };

  for await (const chunk of chunks) {
    buffer += chunk;

    if (!sawHeader) {
      const header = buffer.match(/<header\b[^>]*>/);
      if (header) {
        headerLang = (header[0].match(/srclang="([^"]*)"/) ?? [])[1] ?? headerLang;
        sawHeader = true;
      }
    }

    for (;;) {
      const start = unitOpening();
      if (start === -1) break;
      const end = buffer.indexOf("</tu>", start);
      if (end === -1) {
        // Unterminated so far — bail out only once this single unit has grown
        // absurdly large; a real unit is a sentence or paragraph, never MBs.
        if (buffer.length - start > TMX_MAX_UNIT_BYTES) {
          throw new Error(
            `TMX unit exceeds ${TMX_MAX_UNIT_BYTES / (1024 * 1024)} MB without a closing </tu> — the file is likely truncated or malformed.`,
          );
        }
        break;
      }
      const result = parseUnit(buffer.slice(start, end + 5), headerLang);
      if (typeof result === "string") {
        options.onSkip?.(result);
      } else {
        yield result;
      }
      buffer = buffer.slice(end + 5);
    }

    // Nothing before the next unit opening can still be needed.
    const next = unitOpening();
    if (next > 0) {
      buffer = buffer.slice(next);
    } else if (next === -1 && sawHeader && buffer.length > TAIL_KEEP_CHARS) {
      // No unit opening in view (e.g. trailing content after the last </tu>,
      // or between the header and the first <tu>). Keep only a short tail —
      // enough that a "<tu " / "<tu>" split across a chunk boundary is still
      // detectable — instead of letting the buffer grow for the rest of the
      // stream. Gated on sawHeader so the (short) preamble before the header
      // tag is never cut mid-match.
      buffer = buffer.slice(-TAIL_KEEP_CHARS);
    }
  }

  if (unitOpening() !== -1) {
    // Stream ended with a unit opening still unconsumed — its </tu> never
    // arrived (and it never grew past the size guard above either).
    options.onSkip?.("unterminated-unit");
  }
}
