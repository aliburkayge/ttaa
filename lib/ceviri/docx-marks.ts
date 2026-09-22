import { docxMedia } from "./docx";
import { IMAGE_FORMATS, imageFormat } from "./image-doc";
import { isMark, type MarkKind } from "./marks";
import { inspectImage } from "./ocr";
import { IMAGE_TEXT_MIN_CONFIDENCE, textLines, type ImageInsight } from "./ocr-layout";

/**
 * Word belgesindeki imza ve mühür görselleri (müşteri kuralı: çeviride
 * kopyalanmaz, yerine etiket yazılır). Taranmış belgedeki sınıflandırıcının
 * aynısı kullanılır; mührün içindeki yazı segment olur ve normal çevrilir.
 */

export type DocxMark = { part: string; kind: MarkKind; lineIds: string[] };
export type DocxLayout = { version: "docx-1"; marks: DocxMark[] };
export type MarkSegment = {
  id: string;
  text: string;
  kind: "paragraph";
  order: number;
  ocrWarning: string;
  mark: MarkKind;
};

const INSIDE_IMAGE = "Bu metin bir görselin (imza/mühür alanı) içinden okundu. Aslıyla karşılaştırın.";

export async function findDocxMarks(
  bytes: Uint8Array,
  inspect: (dataUrl: string) => Promise<ImageInsight> = inspectImage,
): Promise<{ layout: DocxLayout; segments: MarkSegment[] }> {
  const media = docxMedia(bytes);
  // EMF/WMF gibi sınıflandırılamayan görseller ve başarısız çağrılar dokunulmadan kalır.
  const insights = await Promise.all(
    media.map(async ({ bytes: data }) => {
      const format = imageFormat(data);
      if (!format) return null;
      try {
        return await inspect(`data:${IMAGE_FORMATS[format].mime};base64,${Buffer.from(data).toString("base64")}`);
      } catch {
        return null;
      }
    }),
  );

  const marks: DocxMark[] = [];
  const segments: MarkSegment[] = [];
  media.forEach(({ part, order }, index) => {
    const insight = insights[index];
    if (!insight || !isMark(insight.kind)) return;
    const texts = insight.lines
      .filter((line) => line.confidence === null || line.confidence >= IMAGE_TEXT_MIN_CONFIDENCE)
      .flatMap((line) => textLines(line.text));
    const lineIds = texts.map((text, k) => {
      const id = `m${index + 1}-${k + 1}`;
      segments.push({ id, text, kind: "paragraph", order, ocrWarning: INSIDE_IMAGE, mark: insight.kind as MarkKind });
      return id;
    });
    marks.push({ part, kind: insight.kind, lineIds });
  });
  return { layout: { version: "docx-1", marks }, segments };
}
