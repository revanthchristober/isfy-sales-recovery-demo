import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function createSession() {
  const result = await pool.query(
    "select public.create_demo_session($1) as id",
    [hash(randomUUID().replaceAll("-", ""))],
  );
  const sessionId = result.rows[0].id;
  const [brandResult, repsResult] = await Promise.all([
    pool.query("select id from public.brands where session_id = $1 order by slug limit 1", [sessionId]),
    pool.query("select id from public.reps where session_id = $1 and brand_id = (select id from public.brands where session_id = $1 order by slug limit 1) order by name", [sessionId]),
  ]);
  return { sessionId, brandId: brandResult.rows[0].id, reps: repsResult.rows.map((row) => row.id) };
}

async function addLead(sessionId, brandId, suffix) {
  const result = await pool.query(
    "select public.ingest_demo_cart_event($1, $2, $3, $4, $5, $6, 12800, true) as result",
    [sessionId, brandId, `concurrency-event-${suffix}`, hash(suffix), `concurrency-cart-${suffix}`, "Demo Customer"],
  );
  assert.equal(result.rows[0].result.status, "created");
  return result.rows[0].result.leadId;
}

async function run() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point to a real Postgres test database");
  const first = await createSession();

  const claimLeadId = await addLead(first.sessionId, first.brandId, "claim-race");
  const claims = await Promise.all(first.reps.slice(0, 2).map((repId) => pool.query(
    "select public.claim_demo_lead($1, $2, $3, $4) as result",
    [first.sessionId, first.brandId, claimLeadId, repId],
  )));
  const claimStatuses = claims.map((result) => result.rows[0].result.status).sort();
  assert.deepEqual(claimStatuses, ["already_claimed", "claimed"], "exactly one competing rep must win");

  const suppressionLeadId = await addLead(first.sessionId, first.brandId, "suppression-race");
  await Promise.all([
    pool.query("select public.suppress_demo_lead($1, $2, $3)", [first.sessionId, first.brandId, suppressionLeadId]),
    pool.query("select public.claim_demo_lead($1, $2, $3, $4)", [first.sessionId, first.brandId, suppressionLeadId, first.reps[0]]),
  ]);
  const suppressedState = await pool.query(
    "select status, is_eligible, assigned_rep_id from public.leads where id = $1",
    [suppressionLeadId],
  );
  assert.equal(suppressedState.rows[0].status, "suppressed");
  assert.equal(suppressedState.rows[0].is_eligible, false);
  assert.equal(suppressedState.rows[0].assigned_rep_id, null);
  const afterSuppressionClaim = await pool.query(
    "select public.claim_demo_lead($1, $2, $3, $4) as result",
    [first.sessionId, first.brandId, suppressionLeadId, first.reps[0]],
  );
  assert.equal(afterSuppressionClaim.rows[0].result.status, "suppressed");

  const recoveryLeadId = await addLead(first.sessionId, first.brandId, "sale-race");
  await pool.query("select public.claim_demo_lead($1, $2, $3, $4)", [first.sessionId, first.brandId, recoveryLeadId, first.reps[0]]);
  const sales = await Promise.all(["sale-event-a", "sale-event-b"].map((eventId) => pool.query(
    "select public.ingest_demo_recovery_event($1, $2, $3, $4, $5, $6, 12800) as result",
    [first.sessionId, first.brandId, eventId, hash(eventId), recoveryLeadId, "same-recovered-order"],
  )));
  assert.deepEqual(sales.map((result) => result.rows[0].result.status).sort(), ["duplicate_order", "recovered"]);
  const recoveryCount = await pool.query(
    "select count(*)::text as count from public.recoveries where session_id = $1 and brand_id = $2 and lead_id = $3",
    [first.sessionId, first.brandId, recoveryLeadId],
  );
  assert.equal(recoveryCount.rows[0].count, "1", "the same order must count once under concurrent delivery");

  const second = await createSession();
  const crossSession = await pool.query(
    "select public.claim_demo_lead($1, $2, $3, $4) as result",
    [second.sessionId, second.brandId, recoveryLeadId, second.reps[0]],
  );
  assert.equal(crossSession.rows[0].result.status, "not_found", "a different visitor cannot access this session's lead");

  console.log("Postgres concurrency checks passed: one claim winner, suppression wins safely, one recovery, and session isolation.");
}

run().finally(() => pool.end()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
