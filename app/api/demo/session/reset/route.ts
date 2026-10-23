import { NextResponse } from "next/server";
import { createFreshDemoSessionResponse } from "@/lib/demo-session-cookie";

export async function POST() {
  try {
    return await createFreshDemoSessionResponse();
  } catch {
    return NextResponse.json({ error: "Could not start a fresh demo." }, { status: 503 });
  }
}
