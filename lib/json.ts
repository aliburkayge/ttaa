function unwrapJson(value: string) {
  const trimmed = value.replace(/^\uFEFF/, "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function repairJsonStrings(value: string) {
  let output = "";
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!inString) {
      output += character;
      if (character === '"') inString = true;
      continue;
    }

    if (character === '"') {
      output += character;
      inString = false;
      continue;
    }

    if (character.charCodeAt(0) <= 0x1f) {
      const escaped = character === "\n" ? "\\n" : character === "\r" ? "\\r" : character === "\t" ? "\\t" : `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
      output += escaped;
      continue;
    }

    if (character !== "\\") {
      output += character;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      output += "\\\\";
      continue;
    }
    if ('"\\/bfnrt'.includes(next)) {
      output += `\\${next}`;
      index += 1;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))) {
      output += value.slice(index, index + 6);
      index += 5;
      continue;
    }

    // Models occasionally escape apostrophes or Unicode punctuation even though
    // JSON does not. Drop that accidental slash; preserve path-like slashes.
    if (/[^a-zA-Z0-9]/.test(next)) output += next;
    else output += `\\\\${next}`;
    index += 1;
  }

  return output;
}

export function parseResilientJson<T>(value: string, source: string): T {
  const normalized = unwrapJson(value);
  try {
    return JSON.parse(normalized) as T;
  } catch (initialError) {
    try {
      return JSON.parse(repairJsonStrings(normalized)) as T;
    } catch {
      const detail = initialError instanceof Error ? initialError.message : "invalid JSON";
      throw new Error(`${source} returned malformed JSON that could not be repaired (${detail}).`);
    }
  }
}
