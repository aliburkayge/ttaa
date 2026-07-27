import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../lib/auth";
import type { LinkBrief } from "../../../lib/link-catalog";
import { researchBrief } from "../../../lib/research";

export async function POST(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const brief = (await request.json()) as LinkBrief;
    if (!brief?.topic?.trim()) return NextResponse.json({ error: "Topic is required." }, { status: 400 });
    return NextResponse.json(await researchBrief(brief));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Research failed." }, { status: 502 });
  }
}
