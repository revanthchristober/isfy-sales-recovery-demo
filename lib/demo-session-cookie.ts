import "server-only";

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, hashSessionToken } from "@/lib/demo-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function createFreshDemoSessionResponse() {
  const token = randomBytes(32).toString("base64url");
  const { error } = await getSupabaseAdmin().rpc("create_demo_session", {
    p_token_hash: hashSessionToken(token),
  });
  if (error) throw new Error("Could not create a demo session.");

  const response = NextResponse.json({ created: true }, { status: 201 });
  response.cookies.set(DEMO_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return response;
}
