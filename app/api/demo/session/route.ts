import { NextResponse } from "next/server";
import { getCurrentDemoSession } from "@/lib/demo-session";
import { createFreshDemoSessionResponse } from "@/lib/demo-session-cookie";

export async function POST() {
  try {
    const existingSession = await getCurrentDemoSession();
    if (existingSession) {
      return NextResponse.json({ created: false, expiresAt: existingSession.expires_at });
    }

    return await createFreshDemoSessionResponse();
  } catch {
    return NextResponse.json({ error: "Could not start the demo session." }, { status: 503 });
  }
}
