import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const DEMO_SESSION_COOKIE = "isfy_demo_session";

export type DemoSession = { id: string; created_at: string; expires_at: string };

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function getCurrentDemoSession(): Promise<DemoSession | null> {
  const token = (await cookies()).get(DEMO_SESSION_COOKIE)?.value;
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("demo_sessions")
    .select("id, created_at, expires_at")
    .eq("token_hash", hashSessionToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error("Could not read the demo session.");
  return data;
}

export async function getDemoBrandForCurrentSession(brandId: string) {
  const session = await getCurrentDemoSession();
  if (!session) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("brands")
    .select("id, slug, name")
    .eq("id", brandId)
    .eq("session_id", session.id)
    .maybeSingle();

  if (error) throw new Error("Could not read the demo brand.");
  return data;
}
