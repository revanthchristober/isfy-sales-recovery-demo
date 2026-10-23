import "server-only";

import { randomUUID } from "node:crypto";
import { getCurrentDemoSession, getDemoBrandForCurrentSession } from "@/lib/demo-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  hashEventPayload, parseCartEvent, parseRecoveryEvent, signDemoBody, verifyDemoSignature,
  type CartEvent, type RecoveryEvent,
} from "@/lib/demo-events";

export async function getScopedDemo(brandId: string) {
  const session = await getCurrentDemoSession();
  if (!session) return { error: "Start a new demo session." } as const;
  const brand = await getDemoBrandForCurrentSession(brandId);
  if (!brand) return { error: "That demo brand is not available in this session." } as const;
  return { session, brand } as const;
}

export async function ingestCartEvent(event: CartEvent) {
  const scoped = await getScopedDemo(event.brandId);
  if ("error" in scoped) return { status: "not_found", message: scoped.error };
  const { data, error } = await getSupabaseAdmin().rpc("ingest_demo_cart_event", {
    p_session_id: scoped.session.id,
    p_brand_id: scoped.brand.id,
    p_event_id: event.eventId,
    p_payload_hash: hashEventPayload(event),
    p_cart_id: event.cartId,
    p_customer_label: event.customerLabel,
    p_amount_cents: event.amountCents,
    p_is_eligible: event.eligible,
  });
  if (error) throw new Error("Could not save the cart event.");
  return data as { status: string; leadId?: string };
}

export async function ingestRecoveryEvent(event: RecoveryEvent) {
  const scoped = await getScopedDemo(event.brandId);
  if ("error" in scoped) return { status: "not_found", message: scoped.error };
  const { data, error } = await getSupabaseAdmin().rpc("ingest_demo_recovery_event", {
    p_session_id: scoped.session.id,
    p_brand_id: scoped.brand.id,
    p_event_id: event.eventId,
    p_payload_hash: hashEventPayload(event),
    p_lead_id: event.leadId,
    p_order_id: event.orderId,
    p_amount_cents: event.amountCents,
  });
  if (error) throw new Error("Could not save the simulated sale.");
  return data as { status: string; leadId?: string; recoveryId?: string };
}

export async function signAndIngestCartEvent(input: Omit<CartEvent, "eventId" | "eventType" | "currency"> & { eventId?: string }) {
  const event: CartEvent = {
    ...input,
    eventId: input.eventId ?? randomUUID(),
    eventType: "cart_abandoned",
    currency: "USD",
  };
  const raw = JSON.stringify(event);
  if (!verifyDemoSignature(raw, signDemoBody(raw))) throw new Error("Could not sign the demo event.");
  const parsed = parseCartEvent(event);
  if (!parsed) throw new Error("The demo cart event is invalid.");
  return { event, result: await ingestCartEvent(parsed) };
}

export async function signAndIngestRecoveryEvent(input: Omit<RecoveryEvent, "eventId" | "eventType" | "currency"> & { eventId?: string }) {
  const event: RecoveryEvent = {
    ...input,
    eventId: input.eventId ?? randomUUID(),
    eventType: "order_recovered",
    currency: "USD",
  };
  const raw = JSON.stringify(event);
  if (!verifyDemoSignature(raw, signDemoBody(raw))) throw new Error("Could not sign the demo event.");
  const parsed = parseRecoveryEvent(event);
  if (!parsed) throw new Error("The demo recovery event is invalid.");
  return { event, result: await ingestRecoveryEvent(parsed) };
}

export function messageForStatus(status: string) {
  const messages: Record<string, string> = {
    created: "Cart added to the lead inbox.",
    duplicate_cart: "Duplicate cart ignored.",
    replayed: "Repeated event ignored.",
    event_conflict: "Event ID was already used with different details.",
    claimed: "Lead claimed.",
    claimed_by_you: "This lead is already assigned to you.",
    already_claimed: "Already claimed.",
    suppressed: "Lead suppressed. No contact or sale action is allowed.",
    already_suppressed: "Lead is already suppressed.",
    recovered: "Simulated sale recorded.",
    already_recovered: "Sale was already recorded.",
    duplicate_order: "Repeated sale ignored.",
    sale_conflict: "A different sale is already recorded for this lead.",
    demo_limit: "This session reached the demo limit. Start again to continue.",
    not_claimed: "Claim this lead before recording a sale.",
    amount_mismatch: "Sale amount must match the cart value in this demo.",
    invalid_rep: "Choose a rep from this brand.",
    not_found: "This item is not available in the current session.",
  };
  return messages[status] ?? "The action could not be completed.";
}

export async function runLeadAction(
  action: "claim_demo_lead" | "suppress_demo_lead",
  brandId: string,
  leadId: string,
  repId?: string,
) {
  const scoped = await getScopedDemo(brandId);
  if ("error" in scoped) return { status: "not_found", message: scoped.error };
  const db = getSupabaseAdmin();
  const args = action === "claim_demo_lead"
    ? { p_session_id: scoped.session.id, p_brand_id: scoped.brand.id, p_lead_id: leadId, p_rep_id: repId }
    : { p_session_id: scoped.session.id, p_brand_id: scoped.brand.id, p_lead_id: leadId };
  const { data, error } = await db.rpc(action, args);
  if (error) throw new Error("Could not update the lead.");
  const result = data as { status: string; repId?: string };
  return { ...result, message: messageForStatus(result.status) };
}

export async function getDemoState() {
  const session = await getCurrentDemoSession();
  if (!session) return null;
  const db = getSupabaseAdmin();
  const [brandsResult, repsResult, leadsResult, recoveriesResult, activityResult] = await Promise.all([
    db.from("brands").select("id, slug, name").eq("session_id", session.id).order("name"),
    db.from("reps").select("id, brand_id, name").eq("session_id", session.id).order("name"),
    db.from("leads").select("id, brand_id, cart_id, customer_label, cart_amount_cents, is_eligible, status, assigned_rep_id, created_at").eq("session_id", session.id).order("created_at", { ascending: false }),
    db.from("recoveries").select("id, brand_id, lead_id, order_id, amount_cents, recovered_at").eq("session_id", session.id).order("recovered_at", { ascending: false }),
    db.from("activity_history").select("id, brand_id, lead_id, action, summary, details, created_at").eq("session_id", session.id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (brandsResult.error || repsResult.error || leadsResult.error || recoveriesResult.error || activityResult.error) {
    throw new Error("Could not load demo data.");
  }
  const reps = repsResult.data ?? [];
  const leads = leadsResult.data ?? [];
  const recoveries = recoveriesResult.data ?? [];
  const activity = activityResult.data ?? [];
  return {
    expiresAt: session.expires_at,
    brands: (brandsResult.data ?? []).map((brand) => ({
      ...brand,
      reps: reps.filter((rep) => rep.brand_id === brand.id),
      leads: leads.filter((lead) => lead.brand_id === brand.id).map((lead) => ({
        ...lead,
        recovery: recoveries.find((recovery) => recovery.lead_id === lead.id) ?? null,
      })),
      recoveredRevenueCents: recoveries.filter((recovery) => recovery.brand_id === brand.id)
        .reduce((total, recovery) => total + recovery.amount_cents, 0),
      activity: activity.filter((item) => item.brand_id === brand.id),
    })),
  };
}

export function createFakeCart(brandId: string, index: number) {
  const sample = [
    { customerLabel: "Morgan Lee", amountCents: 12800, eligible: true },
    { customerLabel: "Casey Jordan", amountCents: 7450, eligible: true },
    { customerLabel: "Taylor Morgan", amountCents: 19200, eligible: false },
  ][index % 3];
  const cartId = `demo-cart-${randomUUID()}`;
  return { brandId, cartId, ...sample };
}
