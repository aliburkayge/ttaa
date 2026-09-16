import { wordpressPagesEnabled } from "../../../../lib/wordpress-target";
import { NextResponse } from "next/server";
import { getAdminSession } from "../../../../lib/auth";

export async function GET() {
  const session = await getAdminSession();
  return NextResponse.json({ authenticated: Boolean(session), wordpressPagesEnabled: Boolean(session) && wordpressPagesEnabled(), email: session?.email ?? null });
}
