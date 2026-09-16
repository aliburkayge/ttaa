import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { isSameOriginPanelRequest } from "../../../../lib/qr-request-origin";
import { createTtaaQrRecord, getTtaaQrRecord, listTtaaQrRecords, setTtaaQrPdf } from "../../../../lib/ttaa-qr-records";

export const runtime = "nodejs";
export const maxDuration = 120;

function json(value: Record<string, unknown>, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
async function authorized() { try { await requireAdminSession(); return true; } catch { return false; } }
function publicRecord(record: NonNullable<Awaited<ReturnType<typeof getTtaaQrRecord>>>) {
  return { id: record.id, details: record.details, createdAt: record.createdAt, updatedAt: record.updatedAt, hasFile: Boolean(record.pdfPath), pdfName: record.pdfName || null };
}

export async function GET(request: Request) {
  if (!await authorized()) return json({ error: "Oturum açmanız gerekiyor." }, 401);
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("list") === "1") {
      const records = await listTtaaQrRecords((params.get("q") || "").slice(0, 120));
      return json({ records: records.map(publicRecord) });
    }
    const number = (params.get("documentNumber") || "").trim();
    if (!number) return json({ error: "Belge numarası gerekli." }, 400);
    const record = await getTtaaQrRecord(number);
    return record ? json(publicRecord(record)) : json({ error: "Belge bulunamadı." }, 404);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Belge listesi okunamadı." }, 500); }
}

export async function POST(request: Request) {
  if (!await authorized()) return json({ error: "Oturum açmanız gerekiyor." }, 401);
  if (!isSameOriginPanelRequest(request)) return json({ error: "Geçersiz istek kaynağı." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 10 * 1024 * 1024) return json({ error: "PDF en fazla 8 MB olabilir." }, 413);
  try {
    const data = await request.formData();
    const mode = String(data.get("mode") || "create");
    if (mode === "create") {
      const record = await createTtaaQrRecord({
        documentNumber: String(data.get("documentNumber") || ""), customer: String(data.get("customer") || ""),
        documentType: String(data.get("documentType") || ""), documentDate: String(data.get("documentDate") || ""),
        driveLink: String(data.get("driveLink") || ""),
      });
      return json(publicRecord(record), 201);
    }
    if (mode !== "pdf" && mode !== "remove") return json({ error: "Geçersiz işlem." }, 400);
    const number = String(data.get("documentNumber") || "").trim();
    if (!number || number.length > 64) return json({ error: "Geçerli belge numarası girin." }, 400);
    const file = data.get("file");
    if (mode === "pdf" && !(file instanceof File)) return json({ error: "PDF dosyası seçin." }, 400);
    const result = await setTtaaQrPdf(number, mode === "pdf" ? file as File : undefined);
    return json({ ...publicRecord(result.record), warning: result.warning });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Belge kaydedilemedi." }, 400); }
}
