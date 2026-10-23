import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type CartEvent = {
  eventId: string;
  eventType: "cart_abandoned";
  brandId: string;
  cartId: string;
  customerLabel: string;
  amountCents: number;
  currency: "USD";
  eligible: boolean;
};

export type RecoveryEvent = {
  eventId: string;
  eventType: "order_recovered";
  brandId: string;
  leadId: string;
  orderId: string;
  amountCents: number;
  currency: "USD";
};

function signingSecret() {
  const secret = process.env.DEMO_EVENT_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("The demo event signing secret is missing or too short.");
  }
  return secret;
}

export function signDemoBody(rawBody: string) {
  return createHmac("sha256", signingSecret()).update(rawBody, "utf8").digest("hex");
}

export function verifyDemoSignature(rawBody: string, signature: string | null) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  let expected: Buffer;
  try { expected = Buffer.from(signDemoBody(rawBody), "hex"); } catch { return false; }
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function hashEventPayload(value: CartEvent | RecoveryEvent) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function parseCartEvent(value: unknown): CartEvent | null {
  if (!isRecord(value)) return null;
  if (
    !isText(value.eventId) || value.eventType !== "cart_abandoned" ||
    !isText(value.brandId, 80) || !isText(value.cartId, 160) ||
    !isText(value.customerLabel, 100) || !Number.isInteger(value.amountCents) ||
    (value.amountCents as number) < 0 || (value.amountCents as number) > 10000000 ||
    value.currency !== "USD" || typeof value.eligible !== "boolean"
  ) return null;
  return {
    eventId: value.eventId,
    eventType: "cart_abandoned",
    brandId: value.brandId,
    cartId: value.cartId,
    customerLabel: value.customerLabel,
    amountCents: value.amountCents as number,
    currency: "USD",
    eligible: value.eligible,
  };
}

export function parseRecoveryEvent(value: unknown): RecoveryEvent | null {
  if (!isRecord(value)) return null;
  if (
    !isText(value.eventId) || value.eventType !== "order_recovered" ||
    !isText(value.brandId, 80) || !isText(value.leadId, 80) ||
    !isText(value.orderId) || !Number.isInteger(value.amountCents) ||
    (value.amountCents as number) < 0 || (value.amountCents as number) > 10000000 ||
    value.currency !== "USD"
  ) return null;
  return {
    eventId: value.eventId,
    eventType: "order_recovered",
    brandId: value.brandId,
    leadId: value.leadId,
    orderId: value.orderId,
    amountCents: value.amountCents as number,
    currency: "USD",
  };
}

export async function readSignedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 8192) return { error: "Event body is too large." } as const;
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 8192) return { error: "Event body is too large." } as const;
  if (!verifyDemoSignature(rawBody, request.headers.get("x-demo-signature"))) {
    return { error: "Event signature is missing or invalid." } as const;
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return { error: "Event body must be valid JSON." } as const; }
  return { body, rawBody } as const;
}
