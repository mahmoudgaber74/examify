# Phase 7.1 — Offline Exam Expiry Report

## Previous Problem

An offline auto-submit was queued in `localStorage`, but reconnecting after the scheduled `end_at` called the Phase 7 wrapper, which delegated to the historical submission function. That historical function rejected the exam because its availability predicate required `end_at >= now()`.

## Root Cause

The client had only `started_at` and a presentation countdown. The queue contained answers, an auto flag, and a client-controlled remaining-seconds value, but no server-issued deadline or recovery capability. The legacy server function also conflated delivery time with exam availability.

## Old Trust Model

- Browser calculated expiry from `started_at + duration`.
- Browser supplied `p_auto` and `time_remaining_seconds`.
- Queued answers were persisted in local storage.
- Reconnect used `submit_exam_attempt` and could be rejected after `end_at`.
- The server did not persist an immutable effective deadline.

## New Trust Model

At server-authoritative attempt creation, the database persists:

- `started_at`: server-created attempt start time.
- `deadline_at`: server-calculated effective deadline.
- `offline_recovery_token`: server-generated, attempt-bound, one-time recovery capability.

The browser uses `deadline_at` only for UX freezing. It stores the recovery token with the frozen queue, but cannot create or extend it. The server locks the attempt, validates ownership, tenant, exam assignment, deadline, payload question/option membership, and finalization state.

## Effective Deadline Rule

`deadline_at = LEAST(started_at + duration, exam.end_at)` when `exam.end_at` exists. All values are PostgreSQL `timestamptz` values. Client clocks and client submission timestamps are not accepted as authority.

## Offline Freeze Behavior

When the browser timer reaches the server-issued deadline, answer mutation is already blocked by the local submission lock, the current answers are frozen into the queue, and the UI reports that synchronization will occur when connectivity returns. Refresh/reload resolves the same attempt and deadline from Supabase; it cannot create a fresh attempt for the same active attempt.

## Server Acceptance Rules

- Before the deadline, a valid student submission is accepted.
- After the deadline, automatic recovery is accepted only with the matching server-issued recovery token.
- A normal late/manual submission is rejected.
- The token is cleared when finalization succeeds.
- The server sets `submitted_at`; the queued browser timestamp is ignored.
- Finalized attempts return their existing state on retries.

## Anti-Tampering Controls

Changing the system clock, editing local storage answers/timestamps, altering the queued remaining time, or changing the deadline in the browser cannot extend the server deadline. The token is checked against the locked server row and is not derived from client input. Cross-user attempts still fail ownership checks. The recovery capability is limited to that student's own attempt and does not reopen finalized attempts.

## Idempotency

Attempt row locking, finalized-state return behavior, the unique answer constraint, and token clearing prevent duplicate answer rows and repeated finalization. Result publication remains protected by the Phase 7 publication event uniqueness constraint.

## Files Changed

- `supabase/migrations/20260916100000_phase7_1_offline_expiry.sql`
- `src/views/ExamRunner.tsx`
- `security/phase7-1-offline-expiry-static.test.mjs`
- `package.json`

## Migration Added

`20260916100000_phase7_1_offline_expiry.sql` is a forward-only migration. It adds nullable transitional timing/recovery fields, safely backfills only existing `in_progress` attempts from server timestamps, updates attempt creation, and replaces the submission RPC with the recovery-aware implementation. No historical migration or production data was edited.

## Tests

- `npm run test:phase7-1` — passed static tests.
- `npm run test:phase7` — passed.
- `npm run test:security` — Phase 7 static tests passed; existing live IDOR tests remained skipped without staging fixtures.
- `npm run typecheck` — passed.
- `npm run lint` — passed with existing warnings.
- `npm run build` — passed.

## Runtime Verification

Blocked. Local Supabase connection to `127.0.0.1:54322` was refused and Docker Desktop was not running. No staging credentials or fixtures were available. Migration execution, concurrent requests, actual RPC behavior, RLS, and browser offline/reconnect behavior therefore remain unverified.

## Remaining Risks

- The recovery token is a server-issued bearer capability held by the student's browser; staging must verify it is scoped and single-use as intended.
- Browser storage remains editable by the device owner. The server prevents deadline extension but cannot prove the semantic history of locally edited answer content without continuous server persistence.
- Provider/deployment and live cross-tenant tests remain pending.

## Final Phase 7 Status

**PHASE 7 IMPLEMENTATION COMPLETE — RUNTIME VERIFICATION PENDING**

