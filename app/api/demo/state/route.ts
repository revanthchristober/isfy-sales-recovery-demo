import { NextResponse } from "next/server";
import { getDemoState } from "@/lib/demo-api";

export async function GET() {
  try {
    const state = await getDemoState();
    if (!state) return NextResponse.json({ error: "Start a new demo session." }, { status: 401 });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the demo." }, { status: 503 });
  }
}
