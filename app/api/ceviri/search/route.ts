import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { parseSearchBody } from "../../../../lib/ceviri/search-request";
import { searchTm } from "../../../../lib/ceviri/tm-store";
import { lookupTerms } from "../../../../lib/ceviri/term-store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    await requireAdminSession();

    const parsed = parseSearchBody(await request.json().catch(() => null));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const [matches, terms] = await Promise.all([
      searchTm({ ...parsed, minScore: 0.45, limit: 20 }),
      lookupTerms(parsed),
    ]);
    return NextResponse.json({ matches, terms });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Arama başarısız." },
      { status: 500 },
    );
  }
}
