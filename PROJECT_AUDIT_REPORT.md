# Examify AI — Full Project Audit Report

Audit date: 2026-09-05  
Scope: repository currently present in the workspace  
Mode: audit only; no production source, migration, configuration, dependency, or data files were modified.

## 1. Executive Summary

Examify AI is a Vite/React/TypeScript education platform backed primarily by Supabase/PostgreSQL, with a Python FastAPI/OpenCV service for OMR processing and Supabase Edge Functions for AI, WhatsApp, and asynchronous workflows.

The project has substantial implementation breadth and a serious security-hardening history. The main exam, grading, OMR, certification, tenant-isolation, and truthful-unavailability work is represented in code and migrations. However, this audit cannot verify a complete end-to-end production flow because the local Supabase database is unavailable and the configured security fixtures are absent. Therefore, database-backed features are generally `NOT VERIFIABLE` or `PARTIALLY WORKING`, not declared working solely from source inspection.

The most important confirmed issue is a deployment contradiction: `vercel.json` sends `Permissions-Policy: camera=(), microphone=()`, while `src/views/ExamRunner.tsx` requests camera access for proctoring and `src/views/Tutor.tsx` requests microphone access for voice messages. Those features will be blocked in browsers honoring the header.

Other important risks are legacy nullable-tenant predicates still present in older security policies, direct client-side result publication paths, a large unverified migration chain, skipped live IDOR tests, static marketplace metrics, and incomplete audio Tutor processing.

Overall health: **broad and security-conscious implementation, but not production-verified**. Recommended release posture: staging only until the P0/P1 items below are resolved and executed against a real isolated Supabase environment.

## 2. Architecture Overview

### Verified stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, lucide-react.
- Client data/auth: `@supabase/supabase-js`; browser-persisted Supabase session.
- Backend/database: Supabase Auth, PostgreSQL, RLS, SQL migrations, RPCs, Storage, Edge Functions.
- Edge Functions: `ai-grading`, `ai-question-generator`, `ai-tutor`, `omr-analyze`, `whatsapp-notification`.
- OMR service: Python FastAPI, OpenCV, pypdfium2, NumPy, QR reading, HMAC-authenticated service API, durable Supabase-backed worker queue.
- AI providers: OpenAI API keys are read only in Edge Functions; AI grading, question generation, and Tutor functions use provider HTTP APIs.
- Messaging: parent in-app notifications and optional Twilio WhatsApp delivery.
- Storage: private Supabase buckets for exams, certificates, institution files, LMS content, and Tutor attachments.
- Deployment: Vercel static frontend configuration in `vercel.json`; GitHub Actions workflow in `.github/workflows/security-audit.yml`.
- Tests: Node API scripts, Node security tests, Playwright E2E tests, and Python pytest tests for OMR.
- Realtime: Supabase config enables realtime, but no verified application subscription was found in the inspected UI modules.
- ORM: none found; data access is Supabase REST/RPC/Storage directly.
- Payment provider: none verified. Marketplace creates pending orders; payment is explicitly unavailable.

### High-level flow

```text
Browser React app
  ├─ Supabase Auth/session/profile lookup
  ├─ Supabase tables/RPCs protected by RLS
  ├─ private Storage signed URLs
  ├─ Edge Functions → OpenAI / Twilio
  └─ ExamRunner local draft/queue → submit_exam_attempt RPC

OMR upload → exam-sheets Storage → omr_processing_jobs RPC
  → Python worker → FastAPI/OpenCV → worker completion RPC
  → omr_results / omr_answers → teacher review/approval
```

## 3. Module Inventory

- Authentication and account activation
- Dashboard and workflow guidance
- Student information system: institutions, branches, academic years, stages, grades, classes, sections, students, parent links
- Question bank and import/OCR helpers
- Exam builder, assignments, scheduling, publishing, and question types
- Student exam runner, local drafts, offline queued submission, deterministic shuffling
- Results and teacher grading
- AI grading and teacher approval
- AI question generation
- Multimodal Tutor sessions, image attachments, voice recording, AI Tutor
- LMS lessons and progress
- OMR bubble-sheet generation, scanning, processing operations, review, approval
- Analytics and reports
- Certifications and revocation
- Marketplace/cart/pending checkout
- Parent portal and notifications
- Programming engine unavailable state
- Math engine unavailable state
- Settings, storage-backed logo, branches, institution settings
- Super-admin institution management
- PWA install prompt and service worker

## 4. Feature Status Matrix

Statuses reflect evidence available in this workspace. `NOT VERIFIED` means the source path exists but the required live infrastructure or complete flow was unavailable.

| Module | Feature | Status | Frontend | Backend | Database | Notes |
|---|---|---|---|---|---|---|
| Auth | Sign-in, sign-up, reset, session refresh | NOT VERIFIED | `src/views/Auth.tsx`, `src/lib/auth.ts` | Supabase Auth | profile tables/RLS | Requires live Auth and profile fixtures |
| Dashboard | Tenant metrics/workflow | NOT VERIFIED | `src/views/Dashboard.tsx` | Supabase queries | institution-scoped tables | Queries are present; no live result verification |
| SIS | Student/institution/academic CRUD | NOT VERIFIED | `src/views/SIS.tsx`, `Institutions.tsx`, `AcademicSetup.tsx` | Supabase REST/RPC | many tenant tables | Large flow; DB unavailable |
| Question Bank | CRUD, import, OCR-assisted parsing | NOT VERIFIED | `src/views/QuestionBank.tsx` | Supabase + OCR client helpers | `questions`, `question_options` | Import and OCR paths need live testing |
| Exam Builder | Create exams/questions/assignments | NOT VERIFIED | `src/views/ExamBuilder.tsx` | Supabase/RPCs | exams/questions/assignments | Multiple writes require transactional verification |
| Exam Runner | Timed exam and authoritative submission | PARTIALLY WORKING | `src/views/ExamRunner.tsx` | `submit_exam_attempt` RPC | attempts/answers | Offline/local behavior implemented; live RPC not verified; proctoring header conflict |
| Exam Results | Student/teacher result views and publish | PARTIALLY WORKING | `src/views/ExamResults.tsx` | direct update + RLS | `exam_attempts`, `answers` | Publication path exists; live authorization and notification delivery not verified |
| Grading | Manual grading and publish | PARTIALLY WORKING | `src/views/Grading.tsx` | Supabase updates/RPCs | attempts/answers | Teacher workflow exists; direct publish update should be server RPC |
| AI Grading | Essay suggestions and teacher approval | NOT VERIFIED | `src/views/AiEngine.tsx` | `ai-grading` | AI result/answer fields | Provider, Edge deployment, and approval path not live-tested |
| AI Generation | Question generation/import | NOT VERIFIED | `src/views/AiEngine.tsx` | `ai-question-generator` | generated/questions | Provider and rollback behavior need staging test |
| Tutor | Text/image/voice session | PARTIALLY WORKING | `src/views/Tutor.tsx` | `ai-tutor` | tutor conversations/messages | Image path exists; audio is only structured as a URL, not transcribed; microphone blocked by Vercel header |
| LMS | Lessons and progress | NOT VERIFIED | `src/views/LMS.tsx` | Supabase queries | LMS tables/RLS | No live enrollment/progress verification |
| OMR | Upload, process, review, approve | PARTIALLY WORKING | `BubbleSheet.tsx`, `OmrOperations.tsx` | Edge enqueue + Python worker | OMR tables/jobs/RPCs | Strong static workflow; local DB/worker/provider chain unverified |
| Analytics | Institutional analytics and item analysis | PARTIALLY WORKING | `src/views/Analytics.tsx` | queries + item-analysis RPC | attempts/answers | Real query code; result correctness and scale unverified |
| Reports | Exam reports/export | PARTIALLY WORKING | `src/views/Reports.tsx` | Supabase queries | attempts/exams | Live RLS/data semantics unverified |
| Certifications | Achievement issue/revoke/PDF | PARTIALLY WORKING | `src/views/Certification.tsx` | issue/revoke RPCs | certificates | Server issuance exists; PDF/Arabic rendering and live issuance unverified |
| Marketplace | Catalog/cart/order | MOCK / DEMO / FAKE | `src/views/Marketplace.tsx` | cart/order RPCs | marketplace/cart/orders | Catalog may be real, but hardcoded dashboard metrics and seller tiers are presented as product data; payment unavailable |
| Parents | Parent portal/student links | PARTIALLY WORKING | `src/views/Parents.tsx` | Supabase queries | parent/link/notification tables | Live parent linkage and visibility unverified |
| Notifications | In-app and WhatsApp | PARTIALLY WORKING | `Topbar.tsx`, publish views | notification Edge Function/Twilio | notification tables | Requires provider secrets, phone data, and staging delivery verification |
| Programming | Code execution/plagiarism | UI ONLY | `src/views/Programming.tsx` | none verified | none verified | Truthful unavailable state; no execution backend |
| Math | Handwriting/step grading | UI ONLY | `src/views/MathEngine.tsx` | none verified | none verified | Explicit unavailable state |
| Settings | Branches/institution settings/storage logo | PARTIALLY WORKING | `src/views/Settings.tsx` | Supabase Storage/queries | settings/branches/storage | Live policies and upload path unverified |
| Super Admin | Institution management/bootstrap | NOT VERIFIED | `App.tsx`, `Institutions.tsx` | bootstrap RPCs/RLS | institutions/staff | Requires live first-admin and role fixtures |

Counts for the matrix: fully working 0; partially working 11; broken 0; mock/fake/demo 1; UI-only 2; not verifiable 11. This deliberately does not convert source presence into a green status.

## 5. Critical Problems

### CRITICAL

1. **Required camera and microphone capabilities are disabled in deployment headers.** `vercel.json:17` sets `camera=(), microphone=()`. `ExamRunner.tsx` calls `getUserMedia({ video: true })`; `Tutor.tsx` calls `getUserMedia({ audio: true })`. This blocks Phase 5 proctoring and Phase 6 voice input in production browsers. Fix and verify the intended origin policy before enabling either feature.

### HIGH

1. **Legacy nullable tenant predicates remain in security policy code.** `supabase/migrations/20260802090000_secure_rls_and_tenant_isolation.sql:371-394` contains `institution_id IS NULL` branches for submissions and similar legacy tables. A row with no tenant can be visible or mutable under those policies, which undermines strict tenant isolation. The later cleanup migration must be applied and the effective deployed policy must be inspected, not just migration text.
2. **Live authorization is unverified.** `npm run test:security` executed four tests but skipped all four because staging fixtures were absent. No claim of IDOR resistance is verified until CI runs with real tenant A/B fixtures.
3. **There are 57 migrations with repeated `CREATE OR REPLACE FUNCTION` and policy rewrites.** Effective schema order, migration success, and rollback behavior are not verified because local PostgreSQL at `127.0.0.1:54322` is unavailable. This creates material deployment/data-integrity risk.
4. **OMR worker/service defaults include a development token.** `services/omr-service/app/config.py` defaults `OMR_SERVICE_TOKEN` to `local-omr-development-token`, and the worker has the same default. If deployed without explicit secret configuration, request authentication becomes guessable.

## 6. Fake / Mock / Demo Functionality

- `src/views/Marketplace.tsx` displays hardcoded metrics: `1.24M$`, `4,820`, `18,400`, and `4.8/5`; seller tiers and 70/30, 80/20, 85/15 splits are static UI values. These are product claims, not fetched records.
- Marketplace checkout explicitly says payment is unavailable and creates a pending order. It must not be marketed as a completed purchase flow.
- `src/views/Programming.tsx` and `src/views/MathEngine.tsx` intentionally show unavailable states. These are not fake success paths and should remain clearly labeled.
- `src/lib/question-import.ts` contains a comment describing a fake worker fallback that fails in the browser. It should be treated as dead/legacy implementation evidence until removed or proven unreachable.
- `src/views/Dashboard.tsx` computes real-looking percentages from query counts. They are not hardcoded, but cannot be verified against live tenant data in this audit.
- `localStorage` in `ExamRunner.tsx` is appropriate for offline resilience, but it is not durable backend persistence and must never be treated as authoritative evidence of submission.

## 7. Broken / Incomplete Features

- Proctoring and Tutor microphone are blocked by `vercel.json` Permissions-Policy.
- Audio Tutor processing is incomplete: `supabase/functions/ai-tutor/index.ts` places a signed audio URL into text content for the OpenAI request; it does not call a transcription service or provide native audio input to a verified provider contract.
- Payment is not implemented: Marketplace creates a pending order and explicitly reports payment unavailable.
- Programming execution, sandboxing, plagiarism analysis, and Math Engine are unavailable by design.
- The local Supabase-dependent test and migration execution path is unavailable in this workspace.

## 8. Frontend Findings

Strengths:

- Central AuthProvider and role-based view allowlists exist in `src/App.tsx`.
- Loading, error, and empty states are common across views.
- ExamRunner has draft persistence, queued submission, deterministic shuffling, and explicit offline messaging.
- AI grading and OMR review expose human approval rather than silently claiming success.

Findings:

- Many data-fetching effects suppress exhaustive-deps warnings; ESLint reported 29 warnings, including `ExamRunner.tsx`, `Tutor.tsx`, and `Certification.tsx`. These can produce stale closures or repeated work.
- `src/views/Analytics.tsx` performs many parallel queries plus a second query for attempts; pagination and query-size limits are not visible.
- `src/views/AcademicSetup.tsx` and other views use broad `select('*')` calls, increasing data exposure and payload size.
- `src/views/Marketplace.tsx` holds static favorites in component state and has seller/action buttons without a verified backend handler.
- `src/views/ExamResults.tsx` and `src/views/Grading.tsx` directly update publication state from the client; RLS may restrict this, but the business transition is not centralized.
- `Tutor.tsx` uses one large render expression and one large message type instead of reusable attachment/message components.
- The repository contains widespread mojibake-looking Arabic text in source output (`Ø`, `Ù` sequences). Whether this is a terminal encoding display issue or committed content was not independently verified; browser visual QA is required.

## 9. Backend Findings

- Edge Functions consistently authenticate bearer tokens in reviewed paths and use service role only server-side.
- AI provider failures generally return explicit unavailable errors in the newer functions.
- `whatsapp-notification` has rate limiting in process memory only; limits reset on cold start and are not shared across instances.
- Twilio delivery failures are caught and leave in-app notification rows, but the UI does not clearly expose per-parent delivery failure.
- `ai-tutor` has no verified deployed-function configuration, provider key, model contract, or audio transcription integration.
- OMR processing is split across Edge enqueue, a Python worker, FastAPI/OpenCV, and completion RPC. This is a sound separation but requires deployment health checks, queue monitoring, and staging replay tests.
- Several Edge Functions use broad catch blocks and safe generic errors. This is good for exposure control but makes operational diagnosis dependent on structured server logs, which were not found as a centralized system.

## 10. Database Findings

- The schema is broad and relational: institutions, profiles, academic structure, exams, questions, attempts, answers, OMR, Tutor, marketplace, parents, notifications, certificates, and jobs.
- RLS is enabled and repeatedly hardened across migrations; effective deployed policies are not verified.
- Migration history is unusually long and contains repeated versions of core functions such as `submit_exam_attempt`; migration-order testing is mandatory.
- Legacy nullable tenant columns and `IS NULL` policy branches remain evidence of isolation debt.
- `supabase/seed.sql` bootstraps storage buckets but does not establish a complete deterministic application fixture set for integration testing.
- Some multi-step frontend workflows use multiple independent writes, such as exam construction and question creation. Where no single RPC transaction exists, partial-write recovery should be tested.
- Analytics item analysis uses finalized attempts only in `20260908110000_phase4_exam_item_analysis.sql`, but it counts canonical `answers`; OMR answer integration into the same analysis is not evident.
- Storage paths are security-sensitive and depend on naming conventions; policies need live tests for malformed paths, cross-tenant paths, signed URL expiry, and deletion.

## 11. Security Findings

### Positive controls observed

- Supabase Auth sessions and profile-backed role lookup.
- Role-based UI allowlists plus database RLS/RPC authorization.
- Private Storage buckets and signed URLs in reviewed flows.
- Service-role keys read from Edge/worker environment, not browser code.
- HMAC, timestamp, body hash, and replay protection in OMR FastAPI requests.
- Explicit tenant predicates in many current policies.
- Security test suite includes cross-tenant read/mutate/revoke scenarios.

### Findings

- **CRITICAL:** camera/microphone Permissions-Policy conflict described above.
- **HIGH:** legacy nullable tenant policy branches.
- **HIGH:** OMR development token defaults.
- **HIGH:** IDOR/role tests are skipped without staging fixtures, so the actual deployed security posture is unknown.
- **MEDIUM:** CSP allows `'unsafe-inline'` and `'unsafe-eval'` in `vercel.json:19`; this expands XSS impact and should be reduced after checking Vite/runtime requirements.
- **MEDIUM:** in-memory rate limiting in WhatsApp function is not durable or horizontally consistent.
- **MEDIUM:** client-side local exam drafts are sensitive data in browser storage and are not encrypted; device compromise exposes them.
- **LOW:** no centralized error tracking or security event dashboard was identified.
- Dependency status is only partially assessed from package metadata and prior remediation history; a fresh vulnerability scan was not run in this audit.

## 12. Business Logic Findings

- Exam submission has a server-authoritative RPC and offline queue, which is the correct trust boundary. Live behavior for duplicate submissions, stale attempts, and time skew is not verified.
- AI essay grading is modeled as suggestion plus teacher approval. The approval path should be tested for score bounds, teacher tenant scope, duplicate approval, and immutable audit history.
- OMR ambiguity is modeled as review rather than zero. The complete worker-to-review-to-approval transition needs staging tests.
- Certificates require published passed attempts and server-generated IDs. PDF generation and Arabic rendering remain unverified.
- Publishing is duplicated in `Grading.tsx` and `ExamResults.tsx`; both invoke notification logic. A single server-side idempotent publication event would avoid duplicate parent notifications.
- Marketplace order creation is not payment entitlement. Product access must not be granted from the current pending-order path.
- Tutor message creation and AI reply are separate operations. If the AI call fails, a user message remains, which is reasonable, but retry/idempotency and user-visible retry controls are not verified.

## 13. UX Findings

- Offline exam messaging is clear and explicit.
- OMR review queue and AI teacher approval communicate human intervention.
- Unavailable states for Math and Programming are appropriately truthful.
- Tutor attachment upload errors are surfaced, but signed preview expiry and retry behavior are not explained.
- The first-run path is complex: institution/bootstrap, academic setup, question bank, exam builder, assignment, exam run, grading, publication, and parent linking are separate modules.
- Marketplace presents polished commercial metrics despite payment being unavailable, which can confuse users about what is actually purchasable.
- Direct `alert()` calls remain in several workflows (`SIS.tsx`, `ExamBuilder.tsx`, `AiEngine.tsx`, `Topbar.tsx`), producing inconsistent feedback and weaker accessibility than inline status components.

## 14. UI / Design Findings

### Critical usability issue

- Permission headers make two advertised capabilities unusable in production.

### Major inconsistencies

- Arabic/English copy and visible encoding quality are inconsistent across modules.
- Some views use reusable `Card`, `Badge`, and `EmptyState`; others use ad-hoc alerts and one-line dense JSX.
- Marketplace uses promotional gradient/metrics while checkout is unavailable, creating a trust mismatch.

### Minor polish issues

- Dense inline JSX reduces maintainability and makes accessibility review harder.
- Some icon-only controls rely mainly on `title`; visible accessible names should be checked.
- Build reports large output chunks above 500 kB, especially the main bundle and PDF worker.

## 15. Responsive Findings

- Tailwind responsive breakpoints are used extensively (`sm`, `md`, `lg`, `xl`).
- OMR, analytics, and dashboard grids have responsive variants.
- Potential issues requiring device verification: dense grading rows, analytics tables/cards, the fixed Tutor 640px chat height, marketplace modal max-height, and long Arabic/English mixed labels.
- No browser/device matrix was executed in this audit. Mobile status is therefore `NOT VERIFIED`.

## 16. Performance Findings

- Production build completed, but Vite reported large chunks: approximately 4.1 MB main minified output and a 2.4 MB PDF worker before gzip.
- `@tensorflow/tfjs` and BlazeFace materially increase the main bundle because they are imported by `ExamRunner.tsx`; dynamic loading when an exam starts would reduce initial application cost.
- Analytics issues many broad parallel queries and client-computes aggregates; server-side aggregate RPCs or bounded queries would scale better.
- `ExamRunner.tsx` reloads exams/attempts and separately fetches questions/options/answers; this is reasonable for security but needs latency testing.
- OMR worker uses a polling loop and in-memory replay tracking; multi-worker and restart behavior require production load testing.
- No centralized metrics/tracing or query performance evidence was found.

## 17. Testing / Build Findings

Commands executed:

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Exit 0; 29 warnings, 0 errors |
| `npm run test:security` | Exit 0; 4 tests skipped because security staging fixtures were unavailable |
| `npm run build` | Passed; Vite emitted large-chunk warnings and dependency `eval` warning from Mammoth |
| `npx supabase db lint --local` | Not executed in this audit report; earlier workspace evidence shows local DB connection refused at `127.0.0.1:54322` |

Test inventory found 21 Playwright specs, 19 root API-test scripts, Node security tests, and Python OMR tests. The presence of tests is verified; meaningful pass coverage against live database/provider behavior is **NOT VERIFIED**.

## 18. Technical Debt

- 57 migration files with duplicate/historical rewrites.
- Repeated direct Supabase calls embedded in views instead of a typed data-access layer.
- Broad `any` usage warnings in `AiEngine.tsx`, `Parents.tsx`, `PWAInstall.tsx`, and `weak-topics.ts`.
- React Hook dependency warnings.
- Static marketplace metrics and action stubs.
- No shared notification/outbox abstraction for publication events.
- No verified centralized logging/error tracking.
- No verified migration rollback strategy.
- Main-bundle weight from PDF and TensorFlow dependencies.
- Environment and staging fixture management depends on external secrets not present in the workspace.

## 19. Missing Production Requirements

### Required for correct operation

- Correct Permissions-Policy for camera/microphone capabilities.
- Live Supabase migration application and schema/RLS verification.
- OpenAI, Twilio, and OMR worker secrets configured in staging.
- Actual audio transcription provider or supported audio model contract.
- Payment provider and entitlement model before marketplace sales are enabled.
- Browser permission/error UX for camera, microphone, fullscreen, and signed attachments.

### Required for production readiness

- Run IDOR and role tests with real isolated tenant fixtures.
- Migration checksum/order validation in CI and a rollback/forward-fix procedure.
- Durable rate limiting and notification idempotency.
- Centralized logs, error tracking, audit event search, and queue monitoring.
- Backup/restore test and database performance baselines.
- CSP hardening and dependency scanning.

### UX improvements

- Consistent inline toasts/dialogs instead of browser `alert()`.
- Clear staged setup checklist and role-specific onboarding.
- Better attachment upload progress, retry, expiry, and deletion feedback.
- Mobile QA for grading, OMR, analytics, and Tutor.

### Optional enhancements

- Dynamic imports for heavy PDF/TensorFlow modules.
- Server-side analytics snapshots for large institutions.
- Realtime queue/result updates after operational requirements are defined.

## 20. Recommended Development Roadmap

### P0 — Critical

1. **Resolve capability header conflict**
   - Problem: `vercel.json` disables camera and microphone required by `ExamRunner.tsx` and `Tutor.tsx`.
   - Impact: proctoring and voice input fail in production.
   - Affected: `vercel.json`, `ExamRunner.tsx`, `Tutor.tsx`.
   - Approach: set a deliberate origin-scoped Permissions-Policy, deploy to staging, verify browser permissions and cleanup behavior.
   - Dependencies: HTTPS staging origin and browser matrix.
   - Risk: Medium; privacy/security policy must remain restrictive.
   - Complexity: Small.

2. **Apply and verify all migrations/RLS in isolated staging**
   - Problem: 57 migrations and local DB unavailable.
   - Impact: unknown effective schema and authorization posture.
   - Affected: `supabase/migrations`, `supabase/config.toml`, CI.
   - Approach: reset a disposable database, apply migrations, inspect effective policies/functions, run smoke and rollback-forward tests.
   - Dependencies: Supabase project/Docker and backups.
   - Risk: High due to data/schema changes.
   - Complexity: Large.

3. **Remove nullable-tenant policy escape hatches**
   - Problem: legacy policies allow `institution_id IS NULL` behavior.
   - Impact: cross-tenant exposure or mutation of orphaned rows.
   - Affected: `20260802090000_secure_rls_and_tenant_isolation.sql` and effective deployed policies.
   - Approach: inventory orphan rows, assign/quarantine safely, enforce NOT NULL where intended, test cross-tenant access.
   - Dependencies: staging snapshot and data-owner decision.
   - Risk: High; data migration.
   - Complexity: Large.

### P1 — High

4. **Run live IDOR and role tests**
   - Problem: four security tests currently skip without fixtures.
   - Impact: security claims are unverified.
   - Affected: `security/idor-authorization.test.mjs`, CI secrets/fixtures.
   - Approach: provision tenant A/B users and run tests as a required protected CI job.
   - Dependencies: isolated staging data.
   - Risk: Medium.
   - Complexity: Medium.

5. **Centralize grade publication into an idempotent server RPC/event**
   - Problem: publication exists as direct client updates in two views and can duplicate notifications.
   - Impact: inconsistent authorization/audit and duplicate parent messages.
   - Affected: `Grading.tsx`, `ExamResults.tsx`, publication migrations, WhatsApp workflow.
   - Approach: one authorized publish RPC with outbox/idempotency key and notification worker.
   - Dependencies: notification schema/operations.
   - Risk: High because it changes grade visibility.
   - Complexity: Large.

6. **Replace OMR development-token defaults**
   - Problem: predictable fallback token in Python config/worker.
   - Impact: unauthorized OMR requests if deployed without environment configuration.
   - Affected: `services/omr-service/app/config.py`, `worker.py`, deployment manifests.
   - Approach: fail closed when token is absent outside explicit local mode; rotate any exposed token.
   - Dependencies: secret manager.
   - Risk: Medium.
   - Complexity: Small.

7. **Finish or disable audio Tutor claims**
   - Problem: audio URL is placed into text; no verified transcription occurs.
   - Impact: users may believe voice messages were understood when they were not.
   - Affected: `Tutor.tsx`, `supabase/functions/ai-tutor/index.ts`.
   - Approach: integrate a supported transcription/audio input provider, or clearly mark audio analysis unavailable.
   - Dependencies: provider, privacy consent, size/duration limits.
   - Risk: Medium.
   - Complexity: Medium.

8. **Implement payment or constrain marketplace to catalog/order intent**
   - Problem: static metrics and pending orders coexist with seller/purchase UI.
   - Impact: misleading commercial behavior and no entitlement enforcement.
   - Affected: `Marketplace.tsx`, marketplace migrations/RPCs.
   - Approach: remove claims, add provider/webhook/entitlement state, or present a clearly non-commercial catalog.
   - Dependencies: payment provider and legal/business rules.
   - Risk: High.
   - Complexity: Large.

### P2 — Medium

9. **Add typed data-access and bounded analytics RPCs**
   - Problem: views contain repeated broad queries and client aggregation.
   - Impact: maintainability, payload size, N+1 risk, and scalability.
   - Affected: analytics, reports, SIS, builder views.
   - Approach: typed query modules, server aggregates, pagination, explicit column lists.
   - Dependencies: stable schema.
   - Risk: Medium.
   - Complexity: Large.

10. **Reduce bundle size and hook/dead-code warnings**
   - Problem: large TensorFlow/PDF bundles and 29 lint warnings.
   - Impact: startup performance and maintenance defects.
   - Affected: `ExamRunner.tsx`, Vite config, warning locations.
   - Approach: dynamic import proctoring/PDF, fix dependency arrays, remove dead helpers after reachability review.
   - Dependencies: browser performance baseline.
   - Risk: Medium.
   - Complexity: Medium.

### P3 — Polish

- Normalize Arabic source encoding and verify rendered localization.
- Replace browser alerts with accessible shared dialogs/toasts.
- Extract repeated message/card/form patterns into design-system components.
- Complete mobile/tablet visual QA and improve icon-only control labels.

## Final Audit Summary

1. Overall project health: broad implementation with strong intended controls, but staging/live verification is incomplete.
2. Critical issues: **1**.
3. High issues: **4**.
4. Medium issues: **6**.
5. Low issues: **2**.
6. Fully working features verified: **0**.
7. Partially working features: **11**.
8. Broken features: **0** as a distinct implementation category; incomplete/unavailable capabilities are called out above.
9. Mock/fake/demo features: **1** module, Marketplace, with additional static metric occurrences.
10. First ten items to address:

   1. Fix camera/microphone Permissions-Policy.
   2. Apply all migrations in disposable staging.
   3. Verify effective RLS and remove nullable-tenant escape hatches.
   4. Run live cross-tenant IDOR tests.
   5. Centralize grade publication and notification idempotency.
   6. Remove OMR development-token defaults.
   7. Finish or disable audio Tutor analysis.
   8. Constrain or implement Marketplace payment/entitlements.
   9. Add typed data access and bounded analytics.
   10. Reduce bundle size and resolve lint/hook/dead-code debt.

This report is the only file created or updated for this audit. No production code was modified.

## Phase 7 implementation update

Phase 7 added server-authoritative lifecycle RPCs and an idempotent result-publication event path. Phase 7.1 adds server-issued `deadline_at` and a one-time offline recovery capability, and the frontend queues that server-issued capability when the attempt freezes. Runtime verification remains pending because local Supabase and staging fixtures are unavailable.

## Phase 8 implementation update

Phase 8 added server-side AI answer/score derivation and structured-output validation, bounded teacher approval, idempotent OMR approval entry, canonical OMR answer integration safeguards, server-authoritative certificate issuance locking, and minimum-disclosure certificate verification. The local migration chain now applies successfully and SQL lint reports no new errors. Provider, worker, concurrency, and cross-tenant staging verification remain pending.

## Phase 2A follow-up (2026-09-05)

The Phase 2A stabilization pass changed the status of three audit findings: `vercel.json` now scopes camera and microphone to the application origin, OMR service/worker authentication now fails closed unless local development is explicitly declared, and Tutor recording now stops its MediaRecorder and tracks on unmount. These fixes are implemented but require staging/browser or container verification.

The security suite now distinguishes explicit local skips from strict CI failure: `.github/workflows/security-audit.yml` sets `REQUIRE_SECURITY_FIXTURES=true`. The local Supabase database remains unavailable, so migration execution, effective RLS inspection, and live IDOR results remain unverified. The ordered migration inventory and tenant matrix are documented in `MIGRATION_VERIFICATION_REPORT.md`; grade publication remains a duplicated direct-update flow and is documented for Phase 2B in `GRADE_PUBLICATION_DESIGN.md`.
