import { NextResponse } from "next/server";
import { runLeadAction } from "@/lib/demo-api";

export async function POST(request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    const { leadId } = await context.params;
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("brandId" in body) || !("repId" in body) ||
      typeof body.brandId !== "string" || typeof body.repId !== "string") {
      return NextResponse.json({ error: "Choose a demo brand and rep." }, { status: 400 });
    }
    const result = await runLeadAction("claim_demo_lead", body.brandId, leadId, body.repId);
    const statusCode = result.status === "claimed" || result.status === "claimed_by_you" ? 200 : result.status === "already_claimed" || result.status === "suppressed" ? 409 : 404;
    return NextResponse.json(result, { status: statusCode });
  } catch {
    return NextResponse.json({ error: "Could not claim this lead." }, { status: 503 });
  }
}
