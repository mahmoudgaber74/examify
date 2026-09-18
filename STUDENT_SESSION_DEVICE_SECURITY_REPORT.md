# Student Session and Exam Device Security

## Implemented

- Added `student_sessions` for one active student browser session per account.
- A new login revokes the previous session at the database boundary.
- The browser stores a non-sensitive local device identifier and sends a session heartbeat every 15 seconds.
- Added `student_exam_device_locks` and `student_exam_device_conflicts`.
- An active attempt accepts one device while its heartbeat is recent; a second device is rejected and logged.
- Added restrictive RLS policies to the canonical exam read/write tables.
- Added a database-side assignment guard so SECURITY DEFINER exam lifecycle functions also reject revoked sessions.

## Scope and privacy

The implementation records a device identifier, a short user-agent label, session identifiers, and timestamps. It does not capture an IP address in the browser. Reliable IP auditing belongs at the Edge Function/reverse-proxy layer, where the server can observe the request source without trusting client input.

## Verification

- `npm run typecheck`: passed.
- `npx supabase db push --local --include-all --yes`: passed.
- `npx supabase db lint --local`: passed with existing warnings only.
- `security/student-session-local-fixture.sql`: added for two login sessions and a concurrent exam-device conflict.
- `security/student-session-device-static.test.mjs`: added and included in `test:security`.

The first clean `supabase db reset --local --yes` exposed a pre-existing migration-order issue: `20260802154832_define_publish_exam_result.sql` expects `publish_exam_result(uuid)` before the canonical lifecycle migration creates it. The local database was restored by repairing only local migration history and creating a temporary local stub; no old migration file was changed. After restoration, both local fixtures passed again.

Production deploy, push, and remote database changes were intentionally not performed.
