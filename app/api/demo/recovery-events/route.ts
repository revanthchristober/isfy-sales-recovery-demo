import { NextResponse } from "next/server";
import { ingestRecoveryEvent, messageForStatus } from "@/lib/demo-api";
import { parseRecoveryEvent, readSignedBody } from "@/lib/demo-events";

export async function POST(request: Request) {
  try {
    const signed = await readSignedBody(request);
    if ("error" in signed) return NextResponse.json({ error: signed.error }, { status: 400 });
    const event = parseRecoveryEvent(signed.body);
    if (!event) return NextResponse.json({ error: "Sale event details are invalid." }, { status: 400 });
    const result = await ingestRecoveryEvent(event);
    const statusCode = result.status === "recovered" ? 201
      : result.status === "event_conflict" || result.status === "duplicate_order" || result.status === "sale_conflict" ? 409
      : result.status === "not_found" ? 404
      : result.status === "demo_limit" ? 429
      : result.status === "suppressed" || result.status === "not_claimed" || result.status === "amount_mismatch" ? 409
      : 200;
    return NextResponse.json({ ...result, message: messageForStatus(result.status) }, { status: statusCode });
  } catch {
    return NextResponse.json({ error: "Could not receive the simulated sale." }, { status: 503 });
  }
}
