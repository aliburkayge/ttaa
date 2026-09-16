export type WordPressTarget = "post" | "page";

export class WordPressTargetError extends Error {
  constructor(message: string, readonly httpStatus = 400) {
    super(message);
  }
}

/** Missing fields belong to pre-selection jobs and always mean a post. */
export function wordpressTarget(value: unknown): WordPressTarget {
  if (value === undefined) return "post";
  if (value === "post" || value === "page") return value;
  throw new WordPressTargetError("Geçersiz WordPress hedefi. Yazı veya Sayfa seçin.");
}

export function wordpressCollection(value: unknown) {
  return wordpressTarget(value) === "page" ? "pages" : "posts";
}

/** Delivery metadata must not change writer/editor prompts or quality repair. */
export function withoutWordPressTarget<T extends object>(brief: T): Omit<T, "wordpressTarget"> {
  const contentBrief = { ...brief };
  delete (contentBrief as { wordpressTarget?: unknown }).wordpressTarget;
  return contentBrief;
}

export function wordpressPagesEnabled() {
  return process.env.WORDPRESS_PAGES_ENABLED === "true";
}

/** Gate new work only; already managed pages can still be read and synchronized. */
export function requireNewWordPressTarget(value: unknown): WordPressTarget {
  const target = wordpressTarget(value);
  if (target === "page" && !wordpressPagesEnabled()) {
    throw new WordPressTargetError("WordPress sayfa aktarımı henüz etkin değil.", 409);
  }
  return target;
}

/** The saved package wins on retry; conflicting form state must never reroute it. */
export function packageWordPressTarget(content: { wordpressTarget?: unknown; wordpress?: { wordpressTarget?: unknown } }, brief?: { wordpressTarget?: unknown }) {
  const target = wordpressTarget(content.wordpress?.wordpressTarget ?? content.wordpressTarget ?? brief?.wordpressTarget);
  for (const value of [content.wordpress?.wordpressTarget, content.wordpressTarget, brief?.wordpressTarget]) {
    if (value !== undefined && wordpressTarget(value) !== target) {
      throw new WordPressTargetError("Kaydedilmiş içeriğin WordPress hedefi değiştirilemez.", 409);
    }
  }
  return target;
}
