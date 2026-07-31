import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getProject, updateProject } from "../../../../lib/projects";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession();
    const { id } = await context.params;
    const project = await getProject(id, session.email);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Project lookup failed." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession();
    const { id } = await context.params;
    const body = await request.json() as { revision?: unknown; article?: unknown };
    if (!Number.isInteger(body.revision)) return NextResponse.json({ error: "A valid revision is required." }, { status: 400 });
    const project = await updateProject({
      id,
      ownerEmail: session.email,
      expectedRevision: Number(body.revision),
      article: body.article,
    });
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (error instanceof Error && error.message === "REVISION_CONFLICT") {
      return NextResponse.json({ error: "This project was updated in another session. Reload it before saving." }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Project update failed." }, { status: 422 });
  }
}
