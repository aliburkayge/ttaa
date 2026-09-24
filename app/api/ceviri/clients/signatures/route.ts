import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { rebuildSignatures } from "../../../../../lib/ceviri/signature-store";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Firma parmak izini bütün bellekten yeniden kurar (bkz. signature-store.ts). */
export async function POST() {
  try {
    await requireAdminSession();
    return NextResponse.json(await rebuildSignatures());
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parmak izi kurulamadı." }, { status: 500 });
  }
}
