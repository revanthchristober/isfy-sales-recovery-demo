import { NextResponse } from "next/server";
import { runLeadAction } from "@/lib/demo-api";

export async function POST(request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    const { leadId } = await context.params;
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("brandId" in body) || typeof body.brandId !== "string") {
      return NextResponse.json({ error: "Choose a demo brand." }, { status: 400 });
    }
    const result = await runLeadAction("suppress_demo_lead", body.brandId, leadId);
    return NextResponse.json(result, { status: result.status === "not_found" ? 404 : 200 });
  } catch {
    return NextResponse.json({ error: "Could not suppress this lead." }, { status: 503 });
  }
}
