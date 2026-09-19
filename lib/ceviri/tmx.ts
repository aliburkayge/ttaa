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

function parseUnit(tuXml: string, fallbackSourceLang: string): TmxUnit | null {
  const tuvs = tuXml.match(/<tuv\b[\s\S]*?<\/tuv>/g) ?? [];
  if (tuvs.length < 2) return null;

  const langOf = (tuv: string) => (tuv.match(/xml:lang="([^"]*)"/) ?? tuv.match(/lang="([^"]*)"/) ?? [])[1] ?? "";
  const declared = (tuXml.match(/<tu\b[^>]*\bsrclang="([^"]*)"/) ?? [])[1] ?? fallbackSourceLang;

  const sourceTuv = tuvs.find((tuv) => langOf(tuv) === declared) ?? tuvs[0];
  const targetTuv = tuvs.find((tuv) => tuv !== sourceTuv);
  if (!targetTuv) return null;

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
      if (end === -1) break;
      const unit = parseUnit(buffer.slice(start, end + 5), headerLang);
      if (unit) yield unit;
      buffer = buffer.slice(end + 5);
    }

    // Nothing before the next unit opening can still be needed.
    const next = unitOpening();
    if (next > 0) buffer = buffer.slice(next);
  }
}
