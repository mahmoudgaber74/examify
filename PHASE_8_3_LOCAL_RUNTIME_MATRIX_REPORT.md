# Examify AI — Phase 8.3 Local Runtime Matrix Report

Date: 2026-09-05

## 1. Executive Summary

Phase 8.3 is **PARTIALLY COMPLETE**. The clean database → fixtures → runtime pipeline now works reproducibly. The executed local matrix includes 11 real RPC assertions and the 4-test authenticated IDOR baseline. The full requested matrix is not complete, so no overall completion claim is made.

## 2. Fixture System

`fixtures:security:local` creates disposable Tenant A/B institutions, real local Auth users, Teacher A, Parent A, Student A/B, exams, question/options, active/submitted/graded attempts, an ambiguous OMR result, and a certificate. `test:runtime:local` runs reset, fixture loading, and runtime assertions in one command. Fixture SQL uses service-role setup only for controlled local test data; authorization checks use real user tokens.

## 3. Clean Reset Result

`npm run test:runtime:local` successfully executed a fresh `supabase db reset --no-seed`, applied all 61 migrations, loaded fixtures, and ran the runtime suite. No manual SQL intervention or skipped migration was used.

## 4. Authenticated IDOR Matrix

`npm run test:security:local`: **4/4 PASS**. Student A was denied Tenant B exam reads, Tenant B student reads, Tenant B certificate revocation, and Tenant B exam mutation. These tests executed with a real local Auth bearer token.

## 5. Exam Attempt Matrix

**PARTIALLY VERIFIED:** valid start, duplicate start idempotency, wrong-tenant exam denial, invalid option rejection, valid submission, and finalized-state replay passed. Assignment/window/expired/answer-mutation-after-submit cases remain unexecuted.

## 6. Offline Recovery Token Matrix

**NOT VERIFIED:** the fixture pipeline exists, but valid, wrong, tampered, cross-user, cross-attempt, expired, replay, and client-clock cases were not executed in this pass.

## 7. Manual Grading Matrix

**NOT VERIFIED:** dedicated manual-grading RPC fixtures and score-bound cases were not executed.

## 8. AI Authorization Matrix

**PARTIALLY VERIFIED:** score-above-max and negative-score approval attempts were rejected by the real local approval RPC. Provider execution and full answer ownership/approval-retry cases remain pending.

## 9. Final Score / Pass-Fail Matrix

**PARTIALLY VERIFIED:** objective submission and server-calculated final state executed. Incomplete manual grading, threshold boundaries, AI-pending, AI-approved, OMR-approved, and all final pass/fail combinations remain pending.

## 10. Publication Idempotency

**PARTIALLY VERIFIED:** publishing a non-ready submitted attempt was rejected. First/second/concurrent publication and event uniqueness were not fully executed.

## 11. Parent Notification Matrix

**NOT VERIFIED:** Parent A fixture exists, but publish-triggered notification visibility and cross-parent isolation were not executed.

## 12. WhatsApp Outbox Matrix

**NOT VERIFIED:** no external Twilio call was made; local outbox deduplication was not fully exercised.

## 13. OMR Approval Matrix

**NOT VERIFIED:** ambiguous OMR fixture exists, but authorized correction, duplicate approval, wrong tenant, and finalized-state checks were not executed.

## 14. OMR → Grading Integration

**NOT VERIFIED:** the OMR fixture is present, but the complete review → approval → authoritative score transition was not proven.

## 15. Certificate Matrix

**PARTIALLY VERIFIED:** unknown credential returned `NOT_FOUND`; cross-tenant revocation was denied. Authoritative VALID issuance, REVOKED transition, eligibility denial, duplicate, and concurrent issuance remain pending.

## 16. Certificate Verification Privacy

**IMPLEMENTED BUT NOT VERIFIED:** the verification RPC exposes a minimum public record in source; returned-field privacy was not exhaustively asserted in runtime tests.

## 17. Storage/RLS Matrix

**PARTIALLY VERIFIED:** private Tutor bucket and policies exist after reset. Owner/other-user/other-tenant/unauthenticated object operations were not executed.

## 18. Signed URL Matrix

**NOT VERIFIED:** signed URL generation, expiry, path manipulation, and unauthorized generation were not executed.

## 19. Concurrency Tests

**NOT VERIFIED:** parallel submission, approval, publication, OMR, and certificate requests were not run.

## 20. Python OMR Status

**BLOCKED:** `pytest` is unavailable and the service has no declared dependency file. No arbitrary dependency installation was performed.

## 21. Deno Status

**BLOCKED:** Deno is unavailable and no equivalent local Edge Function runtime was found.

## 22. External Provider Status

OpenAI, Twilio, and the real OMR worker are **EXTERNAL RUNTIME VERIFICATION PENDING**. Local authorization/boundary tests do not represent provider success.

## 23. Files Changed

- `scripts/setup-local-security-fixtures.mjs`
- `scripts/run-local-runtime.mjs`
- `security/runtime-matrix-local.mjs`
- `security/run-local-security.mjs`
- `package.json`
- `PHASE_8_3_LOCAL_RUNTIME_MATRIX_REPORT.md`

## 24. Migrations Added

No new migration was added in Phase 8.3. The working migration history was not modified. Phase 8.2’s forward RLS recursion repair remains the latest migration.

## 25. Commands and Test Results

| Command | Result |
|---|---|
| `npm run test:runtime:local` | PASS: clean reset + fixtures + 11 assertions |
| `npm run test:security:local` | PASS: 4/4 authenticated IDOR tests |
| `npm run test:phase7` | PASS: 4 static tests |
| `npm run test:phase7-1` | PASS: 4 static tests |
| `npm run test:phase8` | PASS: 4 static tests |
| `npm run test:phase8-1` | PASS: 2 migration tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS: 0 errors, 29 warnings |
| `npm run build` | PASS; bundle warnings remain |
| `npx supabase db lint --local` | PASS with 5 existing warnings |
| Python pytest | BLOCKED |
| Deno validation | BLOCKED |

## 26. Remaining Business Logic Gaps

- Full offline recovery-token security matrix.
- Complete manual/AI grading and pass/fail boundary matrix.
- Publication, parent notification, and outbox deduplication proof.
- OMR approval-to-grading integration proof.
- Certificate VALID/REVOKED/eligibility/concurrency proof.

## 27. Remaining Runtime Gaps

- Storage owner/cross-user/signed URL tests.
- Concurrency tests.
- Python test environment and Deno runtime.
- Browser, OpenAI, Twilio, and staging verification.

## 28. Updated Phase Statuses

- Phase 6 — **IMPLEMENTED — LOCAL DB/STORAGE STRUCTURE VERIFIED — BROWSER/PROVIDER VERIFICATION PENDING**
- Phase 7 — **IMPLEMENTED — LOCAL ATTEMPT BASELINE/IDOR VERIFIED — FULL LIFECYCLE MATRIX PENDING**
- Phase 8 — **IMPLEMENTED — LOCAL AUTHORIZATION/BOUNDARY BASELINE VERIFIED — FULL BUSINESS MATRIX PENDING**
- Phase 8.3 — **PARTIALLY COMPLETE**
- Marketplace — **NOT STARTED**
