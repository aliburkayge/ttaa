import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { syncProjectToWordPress } from "../../../../../lib/projects";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession();
    const { id } = await context.params;
    const project = await syncProjectToWordPress(id, session.email);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (error instanceof Error && error.message === "WORDPRESS_NOT_DRAFT") {
      return NextResponse.json({ error: "The WordPress post is no longer a draft and was not overwritten." }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "WordPress synchronization failed." }, { status: 502 });
  }
}
