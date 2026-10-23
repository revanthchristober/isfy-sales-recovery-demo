import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createFakeCart, getScopedDemo, messageForStatus, runLeadAction,
  signAndIngestCartEvent, signAndIngestRecoveryEvent,
} from "@/lib/demo-api";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type ScenarioBody = {
  brandId?: unknown;
  scenario?: unknown;
  leadId?: unknown;
};

function isScenarioBody(value: unknown): value is ScenarioBody {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isScenarioBody(body) || typeof body.brandId !== "string" || typeof body.scenario !== "string") {
      return NextResponse.json({ error: "Choose a demo scenario." }, { status: 400 });
    }
    const scoped = await getScopedDemo(body.brandId);
    if ("error" in scoped) return NextResponse.json({ error: scoped.error }, { status: 404 });

    if (body.scenario === "create_cart" || body.scenario === "duplicate_cart") {
      const cart = createFakeCart(scoped.brand.id, Math.floor(Math.random() * 3));
      const first = await signAndIngestCartEvent(cart);
      if (body.scenario === "create_cart") {
        return NextResponse.json({ ...first.result, message: messageForStatus(first.result.status) }, {
          status: first.result.status === "created" ? 201 : first.result.status === "demo_limit" ? 429 : 200,
        });
      }
      const duplicate = await signAndIngestCartEvent({ ...cart, eventId: randomUUID() });
      return NextResponse.json({
        status: duplicate.result.status,
        message: messageForStatus(duplicate.result.status),
        ...("leadId" in duplicate.result && duplicate.result.leadId ? { leadId: duplicate.result.leadId } : {}),
      });
    }

    if (typeof body.leadId !== "string") {
      return NextResponse.json({ error: "Choose a lead for this scenario." }, { status: 400 });
    }
    const { data: lead, error: leadError } = await getSupabaseAdmin().from("leads")
      .select("id, brand_id, cart_amount_cents, is_eligible, status")
      .eq("id", body.leadId).eq("session_id", scoped.session.id).eq("brand_id", scoped.brand.id).maybeSingle();
    if (leadError || !lead) return NextResponse.json({ error: "Lead not found in this session." }, { status: 404 });

    if (body.scenario === "competing_claim") {
      const reps = await getSupabaseAdmin().from("reps").select("id").eq("session_id", scoped.session.id).eq("brand_id", scoped.brand.id).order("name");
      if (reps.error || !reps.data || reps.data.length < 2) throw new Error("Could not load demo reps.");
      const claims = await Promise.all(reps.data.slice(0, 2).map((rep) =>
        runLeadAction("claim_demo_lead", scoped.brand.id, lead.id, rep.id)));
      const winner = claims.find((claim) => claim.status === "claimed");
      return NextResponse.json({
        status: winner ? "claimed" : claims[0].status,
        message: winner ? "One rep won the claim. The other saw: Already claimed." : messageForStatus(claims[0].status),
        outcomes: claims.map((claim) => claim.status),
      });
    }

    if (body.scenario === "record_sale") {
      const sale = await signAndIngestRecoveryEvent({
        brandId: scoped.brand.id,
        leadId: lead.id,
        orderId: `demo-order-${randomUUID()}`,
        amountCents: lead.cart_amount_cents,
      });
      const statusCode = sale.result.status === "recovered" ? 201
        : sale.result.status === "suppressed" || sale.result.status === "not_claimed" || sale.result.status === "amount_mismatch" ? 409
        : 200;
      return NextResponse.json({ ...sale.result, message: messageForStatus(sale.result.status) }, { status: statusCode });
    }

    if (body.scenario === "repeat_sale") {
      const { data: existing, error } = await getSupabaseAdmin().from("recoveries")
        .select("order_id, amount_cents").eq("session_id", scoped.session.id)
        .eq("brand_id", scoped.brand.id).eq("lead_id", lead.id).maybeSingle();
      if (error) throw new Error("Could not load sale history.");
      if (existing) {
        const attempt = await signAndIngestRecoveryEvent({
          brandId: scoped.brand.id, leadId: lead.id, orderId: existing.order_id,
          amountCents: existing.amount_cents,
        });
        return NextResponse.json({ status: attempt.result.status, message: messageForStatus(attempt.result.status) }, { status: 200 });
      }
      const event = {
        brandId: scoped.brand.id, leadId: lead.id,
        orderId: `demo-order-${randomUUID()}`, amountCents: lead.cart_amount_cents,
      };
      const first = await signAndIngestRecoveryEvent(event);
      const replay = await signAndIngestRecoveryEvent({ ...event, eventId: first.event.eventId });
      return NextResponse.json({ status: replay.result.status, message: messageForStatus(replay.result.status) });
    }

    if (body.scenario === "suppress_blocked") {
      await runLeadAction("suppress_demo_lead", scoped.brand.id, lead.id);
      const repResult = await getSupabaseAdmin().from("reps").select("id")
        .eq("session_id", scoped.session.id).eq("brand_id", scoped.brand.id).limit(1).single();
      if (repResult.error) throw new Error("Could not load demo rep.");
      const claim = await runLeadAction("claim_demo_lead", scoped.brand.id, lead.id, repResult.data.id);
      return NextResponse.json({ status: claim.status, message: messageForStatus(claim.status) }, { status: 409 });
    }

    return NextResponse.json({ error: "Unknown demo scenario." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Could not run that demo scenario." }, { status: 503 });
  }
}
