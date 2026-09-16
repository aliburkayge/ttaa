import { requireAdminSession } from "../../../../../lib/auth";
import { loadTtaaQrPdf } from "../../../../../lib/ttaa-qr-records";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { await requireAdminSession(); }
  catch { return Response.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 }); }
  const number = new URL(request.url).searchParams.get("documentNumber") || "";
  if (!number || number.length > 64) return Response.json({ error: "Geçerli belge numarası girin." }, { status: 400 });
  try {
    const file = await loadTtaaQrPdf(number);
    if (!file) return Response.json({ error: "PDF bulunamadı." }, { status: 404 });
    return new Response(file.bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "PDF açılamadı." }, { status: 500 }); }
}
