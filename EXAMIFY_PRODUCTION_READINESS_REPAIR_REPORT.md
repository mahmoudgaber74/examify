# Examify — Production Readiness Repair Report

Date: 2026-09-17

## Final status

**PARTIAL — local code, API, Python, and static security gates pass; production readiness is not certified.**

The reviewed source was pushed to `origin/main`. The linked Supabase project was updated with the missing migrations and Edge Function deployments; the OMR Docker service/worker and any Vercel auto-deployment still need separate confirmation. Staging and real-browser acceptance remain required before marking this work `COMPLETE` or accepting payment traffic.

## Repairs completed

### Quick Exam atomicity and tenant safety

- Added `create_quick_exam_atomic(jsonb)` in `supabase/migrations/20260917110000_quick_exam_atomic_idempotency.sql`.
- The server validates authentication, role, tenant, subject, class/section, teacher scope, answer-key length, and option bounds.
- Exam, questions, options, links, Bubble Sheet, and optional assignment are created in one transaction.
- `quick_exam_requests` provides institution-scoped idempotency, fingerprint conflict detection, and retry reuse.
- `src/views/ExamBuilder.tsx` now uses the RPC and preserves the request id across retries.

### Bubble Sheet snapshots and OMR fail-closed behavior

- Bubble Sheet creation persists an immutable finalized snapshot, reloads its stored layout, then generates the PDF.
- OMR worker errors now distinguish permanent input/identity/geometry/template failures from retryable dependency failures.
- Permanent failures call `fail_omr_processing_job` with `p_retryable=false` and do not score or complete a result.
- Local API coverage verifies snapshot creation, storage authorization, approval idempotency, review immutability, page/snapshot authorization, and no legacy-table writes.

### AI Question Generator and AI grading

- Subject loading errors and empty states are surfaced; the first active subject is selected consistently.
- Subject and topic are required before generation, with truthful 503/429 handling.
- Generated questions are not persisted automatically; import remains explicit and authorized.
- AI grading results are bounded, auditable, held for review when needed, and never publish automatically.

### Signup, staff approval, and permissions

- Removed `super_admin` from self-registration in `src/views/Auth.tsx`.
- `supabase/migrations/20260917111000_harden_signup_roles_and_bootstrap.sql` makes tenant bootstrap server-owned and prevents privileged role metadata from self-escalating.
- Staff approval remains an active administrator action; pending staff cannot activate themselves.
- Static security checks cover tenant isolation, role boundaries, password recovery routing, exam lifecycle, notifications, storage, OMR, and AI grading.

## Test and fixture repairs

API fixtures were updated to use the deployed atomic question, attempt, snapshot, and approval RPCs instead of obsolete direct-write paths. They now fail fast with actionable errors. The Python API test fixture uses short parametrization ids so Windows does not exceed its environment-variable length limit. These changes improve test accuracy and do not weaken RLS or authorization assertions.

Changed test/fixture files include:

- `exams-api-test.mjs`
- `exam-runner-persistence-api-test.mjs`
- `questionbank-api-test.mjs`
- `omr-api-test.mjs`
- `omr-storage-api-test.mjs`
- `omr-workflow-api-test.mjs`
- `services/omr-service/tests/test_api.py`

## Verification results

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npm run typecheck` |
| Production build | PASS | `npm run build`; 3369 modules transformed; existing Vite warnings remain |
| Lint | PASS | `npm run lint`; 0 errors, 31 warnings |
| Local security fixtures | PASS | `npm run fixtures:security:local`; DB/REST/Storage ready |
| Static security suite | PASS | `npm run test:security`; 112 passed, 0 failed, 4 skipped |
| Full local API suite | PASS | `npm run test:api`; all suites completed successfully |
| OMR Python suite | PASS | `python -m pytest services/omr-service/tests -q`; 41 passed in 5.77s |
| Local Supabase runtime | PASS | Local REST, Storage, RPC, RLS, and fixture flows exercised |
| GitHub source push | PASS | `origin/main` advanced to commit `991bcc8` |
| Linked Supabase migrations | PASS | 9 previously missing migrations applied; follow-up dry-run reports the remote database is up to date |
| Linked Supabase Edge Functions | PASS | 7 functions deployed; all reported `ACTIVE` |
| Vercel public endpoint | PASS | `https://examifylugano.vercel.app/` returned HTTP 200 from Vercel with the configured security headers |
| Staging migration apply | NOT RUN | No staging project or credentials were provided |
| Playwright E2E UI suite | FAIL — 28 passed, 13 failed, 4 did not run | `npm run test:e2e`; Chromium desktop/mobile executed against local Vite/Supabase |
| In-app browser/manual retest | BLOCKED | In-app browser runtime could not initialize because the Node kernel asset path was unavailable |
| Vercel deployment identity | NOT VERIFIED | Vercel CLI/token is unavailable here; endpoint health is confirmed, but the deployed commit cannot be independently read |

Full API suite breakdown:

`students 7/7`, `academic setup 17/17`, `subjects 12/12`, `exams 40/40`, `runner persistence 14/14`, `teacher authorization 18/18`, `question bank 12/12`, `Storage 33/33`, `OMR Storage 26/26`, `OMR workflow 25/25`, `OMR API 17/17`, `AI grading 23/23`.

Playwright E2E summary:

The suite executed 45 cases using Chromium desktop and mobile projects. The 28 passing cases covered Arabic RTL rendering, authentication, institution and teacher signup/approval, role navigation, dashboard data, question-bank CRUD, OMR core flow, responsive rendering, and selected SIS/report flows. The 13 failures were retained as failures: academic/exam flows could not consistently locate newly-created records or results; three OMR UI flows attempted to fill a readonly question-count control or could not find the upload confirmation; CRUD smoke expected a modal that did not open; reports observed 5 attempts instead of the fixture's expected 3; and SIS flows used native `selectOption` against custom select buttons. Four dependent cases were not run after upstream failures.

## Required staging acceptance before COMPLETE

Run the acceptance fixture on an isolated staging project: create one tenant/owner/year/stage/grade/subject/student, create a five-question MCQ exam with key `ABCDA`, invoke Quick Exam twice with the same request id, generate/download/decode the PDF QR, process one invalid and one valid OMR image, verify scoring and review states, run cross-tenant RLS and role-permission checks, verify grades/subjects updates and Settings tabs in a real browser, and confirm the four skipped isolated-fixture security checks.

Until that run and browser verification pass, readiness for a real teacher remains **conditional** and readiness for accepting money is **not approved**. Current status remains **PARTIAL**, not `COMPLETE`.
