# PHASE A.4 — FINAL LOCAL ACCEPTANCE REPORT

## Status

PARTIAL

## Migration History

### New Forward Migrations

- `supabase/migrations/20260922120000_phase_a_single_answer_invariant.sql`
- `supabase/migrations/20260922130000_phase_a_3_atomic_single_answer_writes.sql`
- `supabase/migrations/20260922140000_phase_a_4_snapshot_idempotency.sql`

### Historical Migrations Modified By This Phase

NONE after restoration of the tracked AI migration to its repository form.

### Pre-existing Migration Anomalies

The working tree contains multiple untracked duplicate/malformed migration filenames, including the three `2026080215*...sql.sql` files and `20260826204047...sql`. They are not deleted or silently rewritten here. A clean `db reset`/future deployment must reconcile these files against Cloud migration history before applying the full chain.

## Local Supabase Stack

PostgreSQL, Auth, and PostgREST were available locally. Security fixtures were created only in the local database. No Cloud credentials or Cloud commands were used.

## PostgREST/JWT Authorization

Real local HTTP checks passed: anonymous eligibility and snapshot RPC calls were rejected; teacher cross-tenant eligibility was rejected; direct objective option delete/update were HTTP no-ops with unchanged authoritative rows; direct objective option insert was rejected. No secrets are recorded.

## Direct REST Invariant Attacks

The exercised delete, update, and insert attacks left the MCQ option set unchanged and valid. HTTP 204 on filtered RLS mutations was treated as a no-op only after a follow-up authoritative SELECT.

## Historical Data Audit

Added read-only `security/phase-a-historical-invariant-audit.sql`. It classifies objective questions with invalid answer invariants separately from question-bank records that are not OMR-compatible. It performs no cleanup. The audit was not run against Cloud.

## Final Snapshot Idempotency Contract

The new RPC uses a request UUID scoped to institution and exam, a semantic fingerprint excluding QR output, and an advisory transaction lock. A first request creates one snapshot; an exact retry reuses it; a new request UUID permits intentional regeneration. The conflicting-payload runtime assertion remains unresolved because the current harness reaches the authoritative count validation before the intended conflict classification.

## Idempotency Runtime Evidence

Local transaction evidence: first request created one finalized snapshot, exact retry returned the same snapshot identity, and the snapshot count increased by one only. Conflicting payload: rejected, but with `omr_template_eligible_question_count_mismatch` rather than `omr_generation_request_conflict`.

## Original Phase A Cases

The existing Phase A harness and MCQ/TF invariant cases passed before the conflicting-idempotency assertion stopped the transaction. The full acceptance run is therefore not complete.

## Quality Gates

- local Auth/PostgREST fixture setup: PASS
- PostgREST/JWT checks: PASS
- Phase A static + A.3/A.4 focused tests: PASS
- original Phase A harness: PARTIAL (valid snapshot and invariant cases pass; conflicting-idempotency expectation needs correction)
- `npm run typecheck`: PASS
- `npm run lint`: PASS with existing warnings
- `npm run build`: PASS with existing Browserslist, bundle-size, and Mammoth eval warnings
- `npm run test:security`: PASS, 89 passed, 0 failed, 4 skipped; A.4 runtime is separate and is not yet in this script

## Files Changed

### NEW FORWARD MIGRATIONS

- `supabase/migrations/20260922140000_phase_a_4_snapshot_idempotency.sql`

### APPLICATION FILES

- `src/views/BubbleSheet.tsx`

### TEST FILES

- `security/phase-a-4-acceptance-static.test.mjs`
- `security/phase-a-4-postgrest-runtime.mjs`
- `security/phase-a-historical-invariant-audit.sql`
- `security/phase-a-runtime-verification.sql`
- `security/omr-template-snapshot-static.test.mjs`

## Remaining Gaps

### FAIL

- None in the completed static/security gates.

### BLOCKED

- Full clean migration-chain reset remains blocked by pre-existing duplicate/malformed untracked migration anomalies.

### NOT RUN

- Cloud data audit, Cloud deployment, and production runtime verification.

### SKIPPED

- Four pre-existing live authorization tests skipped because their required staging fixture variables were unavailable.

## Verdict

NOT READY FOR PHASE B

The explicit conflicting-payload idempotency contract and clean migration-history reconciliation must be resolved and rerun before Phase B.
