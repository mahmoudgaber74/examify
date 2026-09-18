# Phase 8 — AI Grading → OMR → Certification Integrity

## 1. Executive Summary

Phase 8 hardens the academic chain so AI remains a suggestion, OMR remains reviewable machine extraction, and certificates derive only from published authoritative results. The new database migration was applied to the local Supabase instance and passes SQL lint without new errors. Provider, browser, staging-security, and full OMR runtime verification remain pending.

## 2. Previous Architecture

Digital objective grading wrote answer scores during submission. Essay AI grading returned a structured suggestion and stored it through an RPC, while teacher approval recalculated the attempt. OMR approval wrote canonical `answers` rows and an attempt score, but used a separate approval implementation. Certificates already required a passed published attempt but lacked public minimum-disclosure verification and complete concurrency hardening.

## 3. AI Grading Trust Model

`ai-grading` now requires an answer reference, loads the answer, attempt, exam tenant, question text, rubric, and question points from Supabase, and ignores client-supplied authority for those values. The provider receives only the server-derived grading context. Suggestions are stored separately from authoritative `awarded_points`.

## 4. AI Approval Flow

The teacher sees the suggestion, feedback, and rubric result in `AiEngine.tsx`. `approve_ai_answer_score()` requires an authorized role, tenant and teacher exam scope, an unpublished gradeable attempt, bounded score, and review reason. It recalculates the attempt score and keeps publication false. Re-approving an already approved answer is idempotent.

## 5. AI Error / Retry Handling

Missing API keys, provider failures, timeout, invalid JSON/schema, invalid bounds, and invalid rubric criteria return unavailable/error responses. No score is fabricated. Repeated provider calls replace the unapproved suggestion; approval is not triggered by AI response and cannot publish a result.

## 6. OMR Architecture

The flow remains upload → private Storage path → authenticated enqueue RPC → HMAC-authenticated Python service → worker completion RPC → per-question extraction → review → approved canonical answers → exam attempt score. Existing unique job/scan constraints and worker state transitions provide duplicate-processing controls.

## 7. OMR Authentication

FastAPI validates request ID, timestamp, body hash, HMAC signature, and in-memory replay state. Production Compose requires `OMR_SERVICE_TOKEN`. The predictable development token remains available only when the explicit development environment is selected; production configuration fails closed.

## 8. OMR Extraction & Ambiguity

Confidence, blank, multiple-mark, unreadable, invalid, and QR/template mismatch states are preserved as review conditions. Database normalization prevents ambiguous answers from becoming confident scores.

## 9. OMR Review Flow

Authorized staff use `resolve_omr_answer()` to correct a flagged option. Original extracted fields remain present, while manual override, reviewer, and timestamp are retained. `approve_omr_result_idempotent()` locks the result and returns the existing approved state on repeat approval.

## 10. OMR Integration With Final Score

Approved OMR answers are written into the canonical `answers` table for the associated exam attempt. The attempt remains unpublished and is subject to the normal result publication workflow. A trigger clears `is_passed` on submitted/auto-submitted attempts with unresolved manual grading.

## 11. Final Score / Pass-Fail Authority

Server RPCs calculate score, percentage, and pass/fail from database question points and answer values. Client scores, AI confidence, and OMR confidence are not accepted as final authority. OMR attempts requiring manual grading do not receive a final pass flag.

## 12. Certificate Eligibility

`issue_certificate_for_exam()` requires an active student in the institution, a published exam, teacher exam scope where applicable, and a `graded`/`approved`, passed, published attempt. Draft, unpublished, temporary AI, and unresolved OMR results do not qualify.

## 13. Certificate Issuance

Certificate identifiers, score, student, institution, issue date, and issuer are server-derived. Issuance uses an advisory transaction lock for the student/exam achievement and the existing uniqueness rule to prevent duplicates.

## 14. Certificate Verification

Added `verify_certificate(text)`, which returns only minimum public data and explicitly distinguishes `VALID`, `REVOKED`, and `NOT_FOUND`. The Certification UI uses this RPC instead of selecting certificate records directly.

## 15. Certificate Revocation

Existing staff-only `revoke_certificate()` and the non-reactivation trigger remain in force. Revoked certificates cannot silently become active and verification reports `REVOKED`.

## 16. Idempotency / Concurrency

AI approval locks answer/attempt records and refuses already published attempts. OMR approval locks the result and has an idempotent entry point. Certificate issuance locks the logical achievement and uses uniqueness. Publication remains protected by the Phase 7 event uniqueness constraint.

## 17. Security / Tenant Isolation

New paths validate staff role, institution, teacher exam scope, student assignment, attempt status, and server-side question points. Service-role access remains confined to Edge Functions. Live cross-tenant and role tests were not available because staging fixtures are absent.

## 18. Files Changed

- `supabase/functions/ai-grading/index.ts`
- `src/views/AiEngine.tsx`
- `src/views/BubbleSheet.tsx`
- `src/views/Certification.tsx`
- `supabase/migrations/20260917100000_phase8_grading_integrity.sql`
- `supabase/migrations/20260907100000_phase4_teacher_approved_ai_grading.sql` — syntax correction required for the migration chain (`RETURN QUERY` to `RETURN`)
- `security/phase8-integrity-static.test.mjs`
- `package.json`

## 19. Migrations Added

`20260917100000_phase8_grading_integrity.sql`.

## 20. Tests Added

Static tests cover server-derived AI bounds, structured provider output, approval scope, OMR idempotency and ambiguity protection, certificate verification states, and production OMR fail-closed configuration.

## 21. Validation Results

- `npm run typecheck` — passed.
- `npm run test:phase8` — 4 passed.
- `npm run test:security` — Phase 8/static tests passed; 4 existing live IDOR tests skipped for missing fixtures.
- `npm run lint` — passed with existing warnings.
- `npm run build` — passed.
- `npx supabase migration up` — local migration chain applied successfully.
- `npx supabase db lint --local` — no new errors; existing warnings remain in older functions.
- `pytest` — blocked because Python `pytest` is not installed.

## 22. Runtime Verification Status

Local database migration execution and SQL lint are verified. OpenAI provider requests, deployed Edge Function behavior, OMR worker end-to-end processing, certificate issuance/verification with authenticated fixtures, concurrency, and cross-tenant IDOR remain implemented but not verified in staging.

## 23. Remaining Risks

- AI provider schema support and deployed function secrets require live verification.
- OMR’s legacy approval delegate should be exercised with real scans and repeated requests.
- The local migration chain required a correction to an earlier invalid Phase 4 function definition; deployment should run migrations from a clean disposable database before production.
- Existing lint warnings and old function warnings remain outside this phase.

## 24. Final Phase 8 Status

**PHASE 8 IMPLEMENTATION COMPLETE — RUNTIME VERIFICATION PENDING**

