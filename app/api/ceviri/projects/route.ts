import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getCeviriSupabase } from "../../../../lib/ceviri/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Eski arşivde firması kesinleşmemiş projeler: iki firma izi ya da çok zayıf iz. */
export async function GET() {
  try {
    await requireAdminSession();
    const { data, error } = await getCeviriSupabase()
      .from("project_clients")
      .select("project_name, evidence")
      .eq("pending", true)
      .order("project_name");
    if (error) throw new Error(error.message);
    return NextResponse.json({ projects: data ?? [] });
  } catch (error) {
    return failure(error, "Projeler okunamadı.");
  }
}

/** Kullanıcının kararı: proje bir firmaya (ya da genele) bağlanır, o projenin satırları yeniden dağıtılır. */
export async function PATCH(request: Request) {
  try {
    await requireAdminSession();
    const body = (await request.json().catch(() => null)) as { projectName?: unknown; clientId?: unknown } | null;
    const projectName = typeof body?.projectName === "string" ? body.projectName : "";
    const clientId = typeof body?.clientId === "string" && body.clientId ? body.clientId : null;
    if (!projectName) return NextResponse.json({ error: "projectName gerekli." }, { status: 400 });
    const supabase = getCeviriSupabase();
    const { error } = await supabase
      .from("project_clients")
      .update({ client_id: clientId, pending: false, decided_by: "user" })
      .eq("project_name", projectName);
    if (error) throw new Error(error.message);
    const { data, error: applyError } = await supabase.rpc("apply_project_clients", { p_names: [projectName] });
    if (applyError) throw new Error(applyError.message);
    return NextResponse.json({ saved: true, updated: data ?? [] });
  } catch (error) {
    return failure(error, "Karar kaydedilemedi.");
  }
}
