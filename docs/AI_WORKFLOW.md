# AI-assisted development record

This project is an independent demo built with fake data. The current implementation and test setup were created with Codex assistance, followed by direct local checks and code review.

## Claude Code review attempt

- Claude Code 2.1.212 was installed.
- A read-only review was requested in print mode with only file-reading and search tools enabled.
- Claude Code could not authenticate because its saved OAuth session had expired. It returned no review and made no changes.
- No code or review result is attributed to Claude Code. Run that review after signing Claude Code in again if a Claude Code workflow record is required for the application.

## Review and validation performed

- Reviewed the session cookie boundary, server-only Supabase client, HMAC validation, SQL row locks, unique constraints, rollback behavior, and secret handling.
- Added SQL checks for event replay and conflicts, duplicate carts and orders, suppression, brand and session boundaries, least-privilege database access, and forced rollback.
- Added parallel Postgres checks for a competing claim, a claim racing suppression, and two copies of a recovered order.
- Added a browser walkthrough for adding a fake cart, claiming it, recording a sale, reloading, replaying the sale, and checking visitor isolation.
- GitHub Actions is configured to run lint, TypeScript checks, SQL checks, Postgres concurrency checks, a production build, and the browser test against a clean local Supabase stack, then save browser evidence as a short-lived artifact.

## Notes for a real Claude Code session

After re-authentication, use Claude Code to review the actual changed files and ask it to identify concrete correctness or security issues. Record its exact findings, the human decision for each one, any code changes, and the checks rerun afterward. Do not copy generic claims into this file; update it with the actual session results.
