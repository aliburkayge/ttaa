import { NextResponse } from "next/server";
import { authenticateAdmin, startAdminSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    const valid = await authenticateAdmin(body.email, body.password);
    if (!valid) return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    await startAdminSession(body.email);
    return NextResponse.json({ authenticated: true, email: body.email.toLowerCase() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
