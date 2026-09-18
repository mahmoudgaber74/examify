# Examify AI — Phase 8.1 Local Runtime Verification Report

Date: 2026-09-05  
Scope: migration integrity, local runtime, authorization fixtures, and database-backed Phase 6–8 verification.

## 1. Executive Summary

Phase 8.1 is **PARTIALLY WORKING**. The local Supabase services were available for inspection, but a true clean replay was intentionally run after restoring the historical Phase 4 migration. Replay stops at that historical migration because it contains `RETURN QUERY` in a scalar `RETURNS public.answers` function. The later forward repair migration therefore cannot execute on a clean database.

This report does not convert source presence into runtime verification. No production code was changed during the verification pass. Static integrity tests pass; live IDOR and database behavior tests did not run because the clean schema and deterministic fixtures were unavailable after the replay failure.

## 2. Historical Migration Investigation

The repository has a `.git` directory, but it has no usable committed history for the migration and Git reports ownership/safe-directory restrictions under the current Windows account. The migration files are also untracked in the current worktree. Consequently, this workspace cannot prove whether the original Phase 4 file was ever published or applied elsewhere.

The historical file was restored to the invalid form containing:

```sql
RETURN QUERY SELECT * FROM public.answers WHERE id = p_answer_id;
```

It was not left silently modified to make local replay pass.

## 3. Historical Migration Repair

Added `supabase/migrations/20260918100000_phase8_1_ai_grading_migration_repair.sql`. It defines the same AI suggestion function with a valid scalar return (`RETURN answer_row`) and retains server-side answer, attempt, exam, institution, teacher-scope, and score-bound checks.

Important limitation: a forward migration cannot repair a syntax-invalid migration that fails before the forward migration is reached. A deployment owner must choose an explicit migration-history policy (for example, a formal baseline/exception procedure) before clean environments can replay the chain.

## 4. Clean Migration Replay

Command executed:

```text
npx supabase db reset --no-seed
```

Result: **BLOCKED** at `20260907100000_phase4_teacher_approved_ai_grading.sql` with PostgreSQL error `42804: cannot use RETURN QUERY in a non-SETOF function`.

This was a real reset attempt, not a manually altered database. Because reset stopped before Phase 8.1, the current local database cannot be used as a complete Phase 6–8 runtime fixture database.

## 5. Fixture Architecture

No deterministic tenant-A/tenant-B fixture set was executed. Creating fixtures against a partially replayed schema would produce misleading results, so fixture creation was not treated as success. The local security runner now fails loudly when required fixture variables are absent and can load them from the ignored file `test-results/security-local-fixtures.json` when a valid disposable fixture setup is available.

## 6. Cross-Tenant IDOR

Status: **BLOCKED**. `npm run test:security:local` exited with code 2 and listed missing Supabase URL, anon key, user-A token, tenant-B institution, student-B, exam-B, and certificate-B identifiers. It did not skip or simulate these tests.

Required live cases remain: student A reading student B data, cross-tenant exam access, cross-tenant mutation, unauthorized staff actions, and certificate revocation outside scope.

## 7. Exam Attempt Tests

Status: **BLOCKED** by clean replay failure. Duplicate submission, stale attempt, expiry, score calculation, and tenant scoping could not be executed against a clean local schema.

## 8. Offline Recovery Token Tests

Status: **IMPLEMENTED BUT NOT VERIFIED**. The Phase 7.1 static implementation and static tests exist, but local authenticated execution of recovery-token issuance, expiry, single-use behavior, and replay rejection was not possible after reset failure.

## 9. Grading Tests

Status: **BLOCKED** for runtime. Phase 8 static integrity tests passed, including server-derived answer authority, bounded AI score approval, and scoped approval checks. Actual teacher/student tenant fixtures and database RPC execution were not available after reset failure.

## 10. Publication Tests

Status: **BLOCKED** for runtime. Grade publication authorization, unpublished-to-published transition, and final-score visibility require the later migrations and authenticated fixtures.

## 11. Notification Deduplication

Status: **IMPLEMENTED BUT NOT VERIFIED**. The publication/notification source paths exist, but no clean database/outbox fixture and no live provider delivery test were executed. Duplicate publication and retry behavior remain unverified.

## 12. AI Authorization Tests

Status: **IMPLEMENTED BUT NOT VERIFIED**. The `ai-grading` Edge Function derives answer, attempt, exam, institution, and maximum points server-side and validates structured provider output. Deno is not installed locally, and no deployed Edge Function/provider request was executed.

## 13. OMR Database Tests

Status: **BLOCKED** for runtime. OMR review/approval migrations and idempotent approval paths are present in source, but the clean replay did not reach them. Python OMR tests were also not run because `pytest` is not installed and the service declares no project dependency file from which it could be safely installed.

## 14. Certificate VALID / REVOKED / NOT_FOUND Tests

Status: **BLOCKED** for runtime. The `verify_certificate` RPC source supports VALID, REVOKED, and NOT_FOUND outcomes, but those three outcomes were not executed against a clean local database in this verification pass.

## 15. Storage/RLS Tests

Status: **BLOCKED** for runtime. Storage policies and private-bucket definitions are present in migrations/source, but bucket existence, signed URL expiry, cross-tenant denial, and authorized staff access require a successful replay and fixtures.

## 16. Python OMR Tests

Status: **BLOCKED**. `python -m pytest services/omr-service/tests` failed because the `pytest` module is unavailable. No undeclared dependency was installed.

## 17. Deno Status

Status: **BLOCKED**. `deno --version` could not run because Deno is not installed in the environment.

## 18. External Provider Status

OpenAI, Twilio/WhatsApp, and any external OMR worker/provider are **NOT VERIFIED**. They require staging secrets, network access, provider contracts, and operational fixtures; they were not represented as local success.

## 19. Files Changed

Verification-only additions/changes:

- `security/run-local-security.mjs` — fail-closed local fixture runner, with optional ignored fixture-file loading.
- `security/phase8-1-migration-integrity-static.test.mjs` — historical/repair migration assertions.
- `package.json` — `test:phase8-1` script.
- `PHASE_8_1_LOCAL_RUNTIME_VERIFICATION_REPORT.md` — this report.

No production frontend, Edge Function, or historical migration was modified during this verification pass.

## 20. Migrations Added

- `supabase/migrations/20260918100000_phase8_1_ai_grading_migration_repair.sql` — forward repair for environments where the historical function has already been applied.

It cannot make a fresh replay pass while the earlier historical migration remains syntactically invalid.

## 21. Test Results

| Check | Result |
|---|---|
| `npm run test:phase8` | PASS: 4 static tests |
| `npm run test:phase8-1` | PASS: 2 migration-integrity tests |
| `npm run test:security:local` | BLOCKED/FAIL-CLOSED: missing fixtures, exit 2 |
| `npx supabase db reset --no-seed` | BLOCKED: historical Phase 4 SQL error 42804 |
| `deno --version` | BLOCKED: Deno unavailable |
| Python OMR pytest | BLOCKED: pytest unavailable and undeclared |

## 22. Remaining Blockers

1. Decide and document how the invalid historical migration will be handled without silently rewriting published migration history.
2. Re-run a disposable clean database replay through all migrations.
3. Create tenant-A/tenant-B Auth and relational fixtures only after replay succeeds.
4. Run the fail-closed IDOR suite with real local fixture tokens and identifiers.
5. Execute authenticated RPC tests for attempts, offline recovery, grading, publication, notifications, OMR, certificates, Storage, and RLS.
6. Install/use declared Python and Deno toolchains in CI or a controlled verification environment.
7. Verify external AI, WhatsApp, and OMR integrations separately in staging.

## 23. Updated Phase Statuses

- Phase 6 — **IMPLEMENTED BUT NOT VERIFIED**
- Phase 7 — **IMPLEMENTED BUT NOT VERIFIED**
- Phase 8 — **IMPLEMENTED BUT NOT VERIFIED**
- Phase 8.1 — **PARTIALLY WORKING**
- Marketplace — **NOT STARTED**

## Correct Phase Completion Percentage

Phase 8.1 is **not 100% complete**. Based on the required verification gates, the local runtime verification completion is **20%**: static integrity checks passed, while clean replay, fixtures, authenticated database tests, Storage/RLS runtime tests, Deno validation, and Python runtime tests remain blocked or unverified.
