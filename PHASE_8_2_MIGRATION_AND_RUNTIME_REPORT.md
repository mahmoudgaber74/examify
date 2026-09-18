# Examify AI — Phase 8.2 Migration and Runtime Report

Date: 2026-09-05

## 1. Executive Summary

Phase 8.2 is **PARTIALLY COMPLETE**. The migration chain was repaired with the minimum Phase 4 scalar-return correction, replayed from zero, and inspected. Four authenticated baseline cross-tenant IDOR tests executed and passed. The broader lifecycle matrix requested by Phase 8.2 remains incomplete.

## 2. Root Cause of Migration Failure

`record_ai_answer_suggestion` declared `RETURNS public.answers` (a scalar composite value) but used `RETURN QUERY`, which is only valid for set-returning functions. PostgreSQL rejected the migration with SQLSTATE `42804`.

## 3. Migration Publication Evidence

The local `.git` metadata has no usable committed history for this migration and the migration files were untracked in the worktree. No deployment scripts, dumps, or local migration metadata established that the invalid exact artifact had been applied to production. Production was not contacted or mutated.

## 4. Chosen Migration Strategy

Case A was selected: treat the invalid artifact as an unpublished repository defect, correct it minimally, and retain later legitimate migrations. The historical file was not preserved in a known-invalid form because that would make every clean installation impossible.

## 5. Historical Phase 4 Change

Only the invalid return was repaired: the function now selects the updated row into `answer_row` and uses `RETURN answer_row;`. Phase 4 semantics and authorization/score-bound checks were otherwise retained.

## 6. Phase 8.1 Repair Migration Decision

The Phase 8.1 repair migration was removed because it only duplicated the exact syntax repair after the repository chose the clean-replay strategy and there is no evidence it was published. Phase 8 behavior remains in `20260917100000_phase8_grading_integrity.sql`.

## 7. Clean Replay Result

`npx supabase db reset --no-seed` completed from a recreated database through all 61 migration files, without manual SQL intervention, skipped migrations, or fatal dependency/signature/policy errors. A transient local Storage gateway restart message occurred after replay; it did not invalidate the database replay.

## 8. Final Schema Inspection

Verified in the final local database:

- Tutor attachment columns `attachment_url` and `attachment_type`.
- Private `tutor_attachments` bucket (`public = false`).
- `start_exam_attempt`, authoritative `submit_exam_attempt`, and offline-expiry migration objects.
- AI approval, idempotent OMR approval, publication, certificate issuance, and certificate verification functions.
- Final inspected security functions are `SECURITY DEFINER`.
- `result_publication_events`, `omr_results`, `exam_violations`, `certificates`, and `tutor_messages` exist.

## 9. Database Lint

`npx supabase db lint --local` completed with warnings only. Existing warnings concern unused/shadowed variables in `approve_omr_result`, `create_ai_grading_job`, `ai_grade_answer_internal`, `submit_exam_attempt`, and `issue_certificate_for_exam`; no new fatal Phase 6–8 error was reported.

## 10. Test Fixtures

Added `scripts/setup-local-security-fixtures.mjs` and `fixtures:security:local`. It creates isolated local Tenant A/B institutions, real Auth users, student profiles, a Tenant B exam, and a certificate, then writes only local test credentials to ignored `test-results/security-local-fixtures.json`. It does not use production/demo seed data. Teacher, parent, attempt, OMR, publication, and notification fixtures still need to be added for the complete Phase 8.2 matrix.

## 11. Authenticated IDOR Results

`npm run test:security:local`: **4/4 PASS** with a real local Student A bearer token:

- Tenant A cannot read Tenant B exams.
- Tenant A cannot read Tenant B student profile by ID.
- Tenant A cannot revoke Tenant B certificate.
- Tenant A cannot mutate Tenant B exam.

The earlier `student_profiles` recursion was a real failure (`42P17`); it was fixed with `20260918110000_phase8_2_fix_student_policy_recursion.sql`, then reset, refixtured, and retested.

## 12. Offline Recovery Token Results

Status: **IMPLEMENTED BUT NOT VERIFIED**. Phase 7.1 static tests pass, but the complete token matrix (tamper, cross-user, replay, timestamp manipulation, duplicate recovery) was not executed against dedicated attempt fixtures.

## 13. Grading Runtime Results

Status: **IMPLEMENTED BUT NOT VERIFIED**. Final AI authorization and score-bound definitions were inspected; authenticated answer-level grading/approval cases require additional teacher fixtures.

## 14. Publication / Notification Results

Status: **IMPLEMENTED BUT NOT VERIFIED**. Publication RPC and event table exist and were inspected. Publish-once/idempotent notification behavior was not executed with a dedicated finalized-attempt/outbox fixture; external delivery is pending.

## 15. AI Authorization Results

Status: **IMPLEMENTED BUT NOT VERIFIED**. The Edge Function source and database authority checks are present. Deno and OpenAI provider execution were not available/required for local database verification.

## 16. OMR Database Results

Status: **IMPLEMENTED BUT NOT VERIFIED**. OMR tables and idempotent approval RPC exist with final definitions inspected. Authorized/unauthorized review transitions were not executed with dedicated OMR result fixtures.

## 17. Certificate Results

Status: **PARTIALLY VERIFIED**. `verify_certificate(text)` exists and issuance is server-authoritative. NOT_FOUND, VALID, REVOKED, eligibility denial, duplicate issuance, and wrong-tenant revocation were not all executed end-to-end. The IDOR revocation denial was verified.

## 18. Storage/RLS Results

Status: **PARTIALLY VERIFIED**. Private Tutor bucket and attachment columns were verified, and tenant IDOR table access passed. Signed URL expiry and owner/staff/other-user Storage operations were not executed.

## 19. Python OMR Tests

**BLOCKED**. `pytest` is not installed, and the OMR service has no declared project dependency file from which dependencies could be safely installed. No undeclared package was installed.

## 20. Deno Status

**BLOCKED**. Deno is unavailable locally. No equivalent Edge Function runtime validator was present.

## 21. External Provider Status

OpenAI, Twilio/WhatsApp, and the production OMR worker remain **EXTERNAL RUNTIME VERIFICATION PENDING**. No fake provider success was inserted.

## 22. Files Changed

- `supabase/migrations/20260907100000_phase4_teacher_approved_ai_grading.sql` — minimal scalar return repair.
- `supabase/migrations/20260918110000_phase8_2_fix_student_policy_recursion.sql` — forward RLS recursion repair.
- `scripts/setup-local-security-fixtures.mjs` — reproducible local fixtures.
- `security/run-local-security.mjs` — fail-closed fixture loading/runner.
- `security/phase8-1-migration-integrity-static.test.mjs` — updated lineage assertions.
- `package.json` — local fixture and Phase 8.1 test scripts.
- `PHASE_8_2_MIGRATION_AND_RUNTIME_REPORT.md` — this report.

## 23. Tests and Commands

| Command | Result |
|---|---|
| `npx supabase db reset --no-seed` | PASS: complete clean replay |
| `npx supabase db lint --local` | PASS with 5 pre-existing database warnings |
| `npm run fixtures:security:local` | PASS |
| `npm run test:security:local` | PASS: 4/4 executed |
| `npm run test:phase7` | PASS: 4 static tests |
| `npm run test:phase7-1` | PASS: 4 static tests |
| `npm run test:phase8` | PASS: 4 static tests |
| `npm run test:phase8-1` | PASS: 2 static tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; large bundle warnings remain |
| `npm run lint` | PASS: 0 errors, 29 warnings |
| `npx supabase migration list` | BLOCKED: project is not linked; local reset was used instead |

## 24. Remaining Blockers

1. Add and execute full local fixtures for attempts, teachers, parents, grading, publication/outbox, OMR, and certificate lifecycle.
2. Execute the complete offline recovery-token matrix.
3. Execute grading, publication, notification idempotency, OMR, certificate, and Storage/RLS runtime matrices.
4. Provide controlled Python dependency setup and Deno in CI.
5. Run browser and external-provider verification in staging.

## 25. Updated Phase Statuses

- Phase 6 — **IMPLEMENTED — LOCAL DATABASE VERIFIED — BROWSER/PROVIDER VERIFICATION PENDING**
- Phase 7 — **IMPLEMENTED — LOCAL DATABASE/IDOR BASELINE VERIFIED — FULL LIFECYCLE MATRIX PENDING**
- Phase 8 — **IMPLEMENTED — LOCAL MIGRATION/SECURITY BASELINE VERIFIED — FULL AUTHORIZED BUSINESS-PATH MATRIX PENDING**
- Phase 8.2 — **PARTIALLY COMPLETE**: clean replay and IDOR baseline pass; required full runtime matrix remains.
- Marketplace — **NOT STARTED**
