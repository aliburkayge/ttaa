import { NextResponse } from "next/server";
import { endAdminSession } from "../../../../lib/auth";

export async function POST() {
  await endAdminSession();
  return NextResponse.json({ authenticated: false });
}
