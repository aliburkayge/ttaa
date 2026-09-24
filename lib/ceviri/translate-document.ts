import type { ScopeChain } from "./scope";
import { translateSegment, type TranslatedSegment, type TranslationContext } from "./translate";
import { neighbours, sentenceUnits, splitAcross, unitText, type UnitSegment } from "./units";

export type PendingSegment = UnitSegment & { translation: string | null };

/** Satırın sonucu; `unit` birlikte çevrildiği cümlenin ilk satırı (tek başınaysa null). */
export type SegmentResult = TranslatedSegment & { unit: string | null };

type Options = {
  sourceLang: string;
  targetLang: string;
  model: string;
  instructions?: string | null;
  scope?: ScopeChain;
  firmInstructions?: string | null;
  /** Belgenin adı: motor bağlam olarak görür. */
  document: string | null;
  /** Bir çağrıda en az bu kadar satır çevrilir; cümle ortadan bölünmez. */
  limit: number;
  /** Testler motor yerine sahte çevirici verir. */
  translate?: typeof translateSegment;
};

/**
 * Belgenin çevrilmemiş satırlarından bir parti: cümleler bütün olarak,
 * çevresindeki metinle birlikte çevrilir (bkz. units.ts), sonuç satırlara
 * dağıtılır. Çağıran sonucu kaydedip kalan için yeniden çağırır.
 */
export async function translatePending<T extends PendingSegment>(segments: T[], options: Options): Promise<SegmentResult[]> {
  const translate = options.translate ?? translateSegment;
  const all = sentenceUnits(segments);
  // Satırlarından bir kısmı çevrilmiş cümle (sohbetten tek satır yenilendi)
  // bütün olarak yeniden çevrilmez: bekleyen satırlar tek tek çevrilir.
  const units = all.flatMap((unit, index) => {
    const pending = unit.filter((segment) => segment.translation === null);
    if (!pending.length) return [];
    if (pending.length === unit.length) return [{ members: unit, index }];
    return pending.map((segment) => ({ members: [segment], index }));
  });

  const batch: typeof units = [];
  let size = 0;
  for (const unit of units) {
    if (size >= options.limit) break;
    batch.push(unit);
    size += unit.members.length;
  }

  const ask = (segment: { id: string; text: string }, context: TranslationContext) =>
    translate(segment, {
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      model: options.model,
      instructions: options.instructions ?? null,
      scope: options.scope,
      firmInstructions: options.firmInstructions ?? null,
      context,
    });

  const translated = await Promise.all(
    batch.map(async ({ members, index }): Promise<SegmentResult[]> => {
      const context = { document: options.document, ...neighbours(all, index) };
      const head = members[0];
      const result = await ask({ id: head.id, text: members.length > 1 ? unitText(members) : head.text }, context);
      if (members.length === 1) return [{ ...result, unit: null }];

      const sources = members.map((segment) => segment.text);
      const pieces = splitAcross(result.translation, sources);
      if (!pieces) {
        // Çeviri satırlara yetmiyor: satırlar ayrı çevrilir, çevreleri yine bağlamdır.
        return Promise.all(
          members.map(async (segment) => ({ ...(await ask({ id: segment.id, text: segment.text }, context)), unit: null })),
        );
      }
      const alternatives = (result.alternatives ?? []).flatMap((alternative) => {
        const split = splitAcross(alternative.text, sources);
        return split ? [{ engine: alternative.engine, pieces: split }] : [];
      });
      const joined = `${members.length} satır tek cümle olarak çevrildi`;
      return members.map((segment, position) => ({
        ...result,
        id: segment.id,
        text: segment.text,
        translation: pieces[position],
        alternatives: alternatives.map((alternative) => ({ engine: alternative.engine, text: alternative.pieces[position] })),
        note: position === 0 ? [result.note, joined].filter(Boolean).join(" · ") : `Cümlenin devamı: ${joined}`,
        // Uyarı cümlenin tamamı içindir; bir kez, ilk satırda gösterilir.
        warning: position === 0 ? result.warning : null,
        unit: head.id,
      }));
    }),
  );
  return translated.flat();
}
