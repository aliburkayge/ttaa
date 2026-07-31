import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../lib/auth";
import type { JobBrand } from "../../../lib/jobs";
import { listProjects } from "../../../lib/projects";

export const runtime = "nodejs";
export const maxDuration = 30;

function validBrand(value: string | null): value is JobBrand {
  return value === "ttaa" || value === "ay-tercume";
}

export async function GET(request: Request) {
  try {
    const session = await requireAdminSession();
    const brand = new URL(request.url).searchParams.get("brand");
    if (!validBrand(brand)) return NextResponse.json({ error: "Brand must be ttaa or ay-tercume." }, { status: 400 });
    return NextResponse.json({ projects: await listProjects(session.email, brand) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Project list failed." }, { status: 500 });
  }
}
