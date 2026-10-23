import { NextResponse } from "next/server";
import { ingestCartEvent, messageForStatus } from "@/lib/demo-api";
import { parseCartEvent, readSignedBody } from "@/lib/demo-events";

export async function POST(request: Request) {
  try {
    const signed = await readSignedBody(request);
    if ("error" in signed) return NextResponse.json({ error: signed.error }, { status: 400 });
    const event = parseCartEvent(signed.body);
    if (!event) return NextResponse.json({ error: "Cart event details are invalid." }, { status: 400 });
    const result = await ingestCartEvent(event);
    const statusCode = result.status === "created" ? 201
      : result.status === "event_conflict" ? 409
      : result.status === "demo_limit" ? 429
      : result.status === "not_found" ? 404 : 200;
    return NextResponse.json({ ...result, message: messageForStatus(result.status) }, { status: statusCode });
  } catch {
    return NextResponse.json({ error: "Could not receive the cart event." }, { status: 503 });
  }
}
