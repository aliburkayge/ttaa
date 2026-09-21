import { strToU8, zipSync } from "fflate";
import { encodeXml } from "./docx";
import { placeholderFor, type LayoutBlock, type OcrLine } from "./ocr-layout";

/**
 * Taranmış PDF'in çevirisinden sıfırdan Word üretir.
 *
 * DOCX kaynaklarında orijinal dosyayı yerinde değiştiriyoruz (docx.ts); PDF'te
 * değiştirilecek bir Word yok, bu yüzden OCR'ın çıkardığı düzenden yazıyoruz.
 * Müşterinin kendi teslimatlarından çıkan kurallar:
 *
 *  - Sayfa yapısı korunur: kaynakta sayfa bitiyorsa çeviride de biter. Sayfa
 *    sonunda bölünen tablo satırı bile insan çevirisinde bölünmüş bırakılmış.
 *  - Logo ve ürün fotoğrafı görsel olarak konur.
 *  - İmza ve mühür kopyalanmaz; yerine [İMZA] / [MÜHÜR] yazılır.
 */

const EMU_PER_INCH = 914_400;
/** A4, 2 cm kenar boşluğu: yazılabilir genişlik ≈ 17 cm. */
const MAX_WIDTH_EMU = Math.round((17 / 2.54) * EMU_PER_INCH);

type Media = { name: string; rId: string; bytes: Uint8Array; ext: "jpeg" | "png" };

function run(text: string, options: { bold?: boolean; size?: number; color?: string } = {}): string {
  const props = [
    options.bold ? "<w:b/>" : "",
    options.color ? `<w:color w:val="${options.color}"/>` : "",
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : "",
  ].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${encodeXml(text)}</w:t></w:r>`;
}

/** Bir hücre ya da paragraf: satırlar arasında Word satır sonu. */
function linesRuns(texts: string[], options: Parameters<typeof run>[1] = {}): string {
  return texts.map((text, index) => (index ? "<w:r><w:br/></w:r>" : "") + run(text, options)).join("");
}

function paragraph(inner: string, spacingAfter = 120): string {
  return `<w:p><w:pPr><w:spacing w:after="${spacingAfter}"/></w:pPr>${inner}</w:p>`;
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; ext: "jpeg" | "png" } | null {
  const match = /^data:image\/(jpe?g|png);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return {
    ext: match[1].toLowerCase() === "png" ? "png" : "jpeg",
    bytes: new Uint8Array(Buffer.from(match[2], "base64")),
  };
}

function drawing(media: Media, id: number, widthEmu: number, heightEmu: number): string {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="${id}" name="Görsel ${id}"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${media.name}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="${media.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function table(block: Extract<LayoutBlock, { kind: "table" }>, text: (line: OcrLine) => string): string {
  const columns = Math.max(1, ...block.rows.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0)));
  const colWidth = Math.floor(5000 / columns);
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${Math.floor(9638 / columns)}"/>`).join("");
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;

  const rows = block.rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const span = cell.colspan > 1 ? `<w:gridSpan w:val="${cell.colspan}"/>` : "";
          const content = cell.lines.length ? linesRuns(cell.lines.map(text)) : "";
          return `<w:tc><w:tcPr><w:tcW w:w="${colWidth * cell.colspan}" w:type="pct"/>${span}</w:tcPr><w:p>${content}</w:p></w:tc>`;
        })
        .join("");
      return `<w:tr>${cells}</w:tr>`;
    })
    .join("");

  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>${paragraph("", 120)}`;
}

/**
 * @param translations segment id → çeviri. Çevrilmemiş satırda kaynak metin
 *   yazılır; boş bırakmak bir satırın sessizce kaybolması demek olurdu.
 */
export function buildDocxFromLayout(
  blocks: LayoutBlock[],
  translations: Map<string, string>,
  targetLang: string,
): Uint8Array {
  const text = (line: OcrLine) => translations.get(line.id) ?? line.text;
  const media: Media[] = [];
  const body: string[] = [];
  let currentPage = blocks[0]?.page ?? 1;
  let drawingId = 0;

  for (const block of blocks) {
    if (block.page !== currentPage) {
      body.push(PAGE_BREAK);
      currentPage = block.page;
    }

    if (block.kind === "table") {
      body.push(table(block, text));
      continue;
    }

    if (block.kind === "image") {
      const placeholder = placeholderFor(block.image, targetLang);
      const decoded = !placeholder && block.data ? decodeDataUrl(block.data) : null;
      if (decoded) {
        const index = media.length + 1;
        const item: Media = {
          name: `image${index}.${decoded.ext}`,
          rId: `rIdImg${index}`,
          bytes: decoded.bytes,
          ext: decoded.ext,
        };
        media.push(item);
        let width = Math.round((block.widthPx / block.dpi) * EMU_PER_INCH);
        let height = Math.round((block.heightPx / block.dpi) * EMU_PER_INCH);
        if (width > MAX_WIDTH_EMU) {
          height = Math.round(height * (MAX_WIDTH_EMU / width));
          width = MAX_WIDTH_EMU;
        }
        body.push(paragraph(drawing(item, ++drawingId, width, height)));
      } else if (placeholder) {
        body.push(paragraph(run(placeholder)));
      }
      // Görselin içinden okunan basılı metin (imzacı adı, unvanı) altına yazılır.
      if (block.lines.length) body.push(paragraph(linesRuns(block.lines.map(text))));
      continue;
    }

    const texts = block.lines.map(text);
    if (block.role === "title") body.push(paragraph(linesRuns(texts, { bold: true, size: 26 }), 160));
    else if (block.role === "header" || block.role === "footer") {
      body.push(paragraph(linesRuns(texts, { size: 18, color: "595959" }), 80));
    } else body.push(paragraph(linesRuns(texts)));
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="${encodeXml(targetLang)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media
    .map(
      (item) =>
        `<Relationship Id="${item.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${item.name}"/>`,
    )
    .join("")}</Relationships>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "word/document.xml": strToU8(documentXml),
    "word/styles.xml": strToU8(stylesXml),
    "word/_rels/document.xml.rels": strToU8(documentRels),
  };
  for (const item of media) files[`word/media/${item.name}`] = item.bytes;

  return zipSync(files);
}
