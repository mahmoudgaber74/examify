# Examify AI — Phase 8.5 Final Local Academic Verification Report

Date: 2026-09-05

## 1. Executive Summary

Phase 8.5 is **PARTIALLY COMPLETE**. The project has a reproducible clean migration reset and a working authenticated baseline, but the final academic blocker matrix was not fully executed. No external provider calls were made and Marketplace was not started.

## 2. Offline Recovery Matrix

**NOT VERIFIED in this pass.** The runtime harness now includes fixtures for an expired attempt and cases for late normal submission, wrong token, valid recovery, and replay. The latest Auth restart was not stable enough to produce a fresh authenticated run, so these cases are not reported as passed.

## 3. Recovery Token Security

The token is a server-generated random UUID stored on the attempt, scoped by the authenticated student/attempt lookup, and cleared during successful submission by the current RPC. It is not a signed token or hash. Guessability/replay resistance requires the pending runtime matrix; no redesign was made.

## 4. Parent Notification Flow

**NOT VERIFIED.** Parent A fixture exists, but publication-triggered notification recipient isolation was not executed.

## 5. Publication / Outbox Idempotency

**PARTIALLY VERIFIED.** A graded result was published locally and the sequential retry returned the same publication event ID. Parent notification and WhatsApp/outbox deduplication counts were not verified.

## 6. Parent Authorization

**NOT VERIFIED.** Parent authentication and cross-student result/notification cases remain pending.

## 7. OMR Approval Matrix

**NOT VERIFIED.** An ambiguous OMR fixture exists, but authorized correction, unauthorized approval, wrong-tenant approval, blank/multiple-mark semantics, and duplicate approval were not executed.

## 8. OMR Audit Trail

**IMPLEMENTED BUT NOT VERIFIED.** The schema stores detected/manual values, confidence/review fields, reviewer, and timestamps. Runtime preservation of machine evidence was not asserted.

## 9. OMR-to-Grading Integration

**NOT VERIFIED.** The complete OMR approval → authoritative answer → score path was not proven. This remains an academic integrity gate.

## 10. OMR Idempotency

**NOT VERIFIED.** Parallel or repeated OMR approval was not run.

## 11. Tutor Storage/RLS

**PARTIALLY VERIFIED.** The private bucket and policy definitions exist after clean reset. Owner/other-user/other-tenant/unauthenticated Storage requests were not executed.

## 12. Signed URLs

**NOT VERIFIED.** Generation, expiry, path manipulation, and unauthorized generation remain pending.

## 13. OMR Storage/RLS

**NOT VERIFIED.** OMR Storage authorization was not executed.

## 14. Submission Concurrency

**NOT VERIFIED.** Concurrent submission/recovery calls were not run.

## 15. Grading Concurrency

**NOT VERIFIED.** Parallel approval calls were not run.

## 16. Publication Concurrency

**NOT VERIFIED.** Only sequential publication retry was verified.

## 17. OMR Concurrency

**NOT VERIFIED.** No parallel OMR approval was run.

## 18. Certificate Concurrency

**NOT VERIFIED.** Sequential issuance/verification/revocation is locally verified from Phase 8.4; concurrent issuance was not run.

## 19. Expanded IDOR

The baseline remains **4/4 PASS** with real local Auth. The required expanded cases—teacher cross-tenant publication/OMR/certificate, parent cross-student access, and Storage cross-user access—were not executed.

## 20. Clean Reset Regression

`npm run test:runtime:local` has successfully performed clean reset → fixtures → runtime in earlier runs. The latest harness extension was interrupted by local Auth readiness and therefore needs one fresh successful run before this phase can close.

## 21. Bugs Found/Fixes

- Fixed stale-fixture false-positive risk by requiring fixture keys and failing closed.
- Fixed fixture SQL stdin handling.
- Added deterministic expired-attempt/recovery-token fixture coverage.
- Added retry/readiness handling for local Auth setup.
- No historical migration was modified in Phase 8.5.

## 22. Test Results

| Area | Result |
|---|---|
| Prior runtime baseline | PASS: 16 assertions |
| Prior authenticated IDOR baseline | PASS: 4/4 |
| New Phase 8.5 recovery run | NOT VERIFIED: Auth readiness interruption |
| Phase 7 static tests | PASS |
| Phase 7.1 static tests | PASS |
| Phase 8 static tests | PASS |
| Typecheck/build/lint | Previously PASS; lint has warnings only |
| DB lint | PASS with existing warnings |

## 23. External/Staging Blockers

OpenAI, Twilio, external OMR worker, browser behavior, Deno, and Python OMR execution remain staging/environment verification items. They were not used to simulate local success.

## 24. Updated Phase Statuses

- Phase 6 — **IMPLEMENTED — LOCAL STRUCTURE VERIFIED — BROWSER/PROVIDER PENDING**
- Phase 7 — **IMPLEMENTED — LOCAL BASELINE VERIFIED — FULL RECOVERY/PUBLICATION MATRIX PENDING**
- Phase 8 — **IMPLEMENTED — LOCAL BASELINE VERIFIED — FULL OMR/STORAGE/CONCURRENCY MATRIX PENDING**
- Phase 8.5 — **PARTIALLY COMPLETE**

## 25. Marketplace Gate

**CAN MARKETPLACE BEGIN? NO.** Offline recovery, parent/outbox behavior, OMR-to-grading integrity, Storage authorization, and concurrency correctness are not all runtime-verified locally.
# Phase 8.5 Verification Harness Repair Addendum

Date: 2026-09-05

## Harness status

The harness repair is implemented but the full Phase 8.5 run is not complete. The local command now follows:

`db reset --no-seed` → bounded local-service retry → Auth readiness → idempotent Auth fixtures → session validation → harness smoke → runtime matrix → expanded IDOR tests.

No product feature or Marketplace code was changed.

## Storage Readiness Root Cause

The local CLI reported `LegacyStorageGatewayStatusError`, HTTP 502, from the Storage status path during container restart. A later direct probe returned HTTP 400, proving the gateway was reachable; this was not treated as a successful business request.

## Service Readiness Strategy

Database/REST discovery, Auth health, and Storage gateway readiness are tracked independently. Storage retries only connection failures and HTTP 502/503/504 with a finite 30-second backoff window; 400/401/403/404 are treated as reachable responses, not readiness retries.

## Final Harness Smoke Result

PASS in the completed fixture run: all four users authenticated, the authenticated DB request passed, and Storage responded. The final reset-and-matrix attempt was interrupted while the Supabase CLI was still applying migrations and therefore has no final matrix result.

## Complete Runtime Matrix Results

Not completed. The matrix started once and exposed a fixture defect; after correcting the fixture, subsequent clean reset attempts were blocked by Storage Gateway 502 during restart. No business assertion is reported as PASS unless it actually completed.

## Harness Errors

Storage readiness/reset lifecycle failures are classified as `HARNESS_ERROR`.

## Business Failures

None confirmed. The observed attempt-selection mismatch was a fixture determinism issue and was corrected by making the active attempt number higher than the recovery attempt.

## External-Only Blockers

Provider delivery, external OMR worker, browser audio, Deno, and Python tests remain external-only and were not converted into local PASS claims.

## Marketplace Gate

NO. The required complete local matrix and all required concurrency/Storage/signed-URL cases have not completed.

## Stable-Instance Verification Strategy

Runtime verification was separated from clean reset. On the already-running local instance, fixtures were prepared without restarting containers, then smoke, runtime, IDOR, and Storage suites were run independently. The clean reset remains a separate regression operation.

## Individual Runtime Suite Results

| Suite | Result |
|---|---|
| Harness smoke | PASS: AUTH/DB/STORAGE |
| Runtime lifecycle matrix | 16 PASS, 0 FAIL |
| Baseline expanded IDOR | 4 PASS, 0 FAIL |
| Storage API authorization | 18 PASS, 14 FAIL |

The Storage failures are classified as a real local authorization/integration failure for authorized operations: `permission denied for table tutor_conversations`. Anonymous denial cases passed. No retry was used for these business responses.

## Offline Recovery Results

Executed inside the runtime matrix: valid recovery, late normal submission, wrong token, replay, and finalized behavior passed. Modified-token, other-attempt, other-user, cross-tenant, deadline-tampering, and second-tab cases are not represented by the existing executable matrix.

## Publication/Notification Results

Publication and idempotent retry passed in the runtime matrix. Parent notification/outbox record-count assertions were not independently executed by the available local suite.

## OMR Results

OMR fixtures exist, but the available executable local suite did not complete the approval/correction/concurrency and OMR-to-authoritative-grading assertions.

## Storage/Signed URL Results

Storage gateway reachability passed. The existing Storage API suite executed 32 cases; 18 passed and 14 failed due to the `tutor_conversations` table permission issue. Signed URL cases were reached but failed with the same underlying authorization error.

## Concurrency Results

Not executed by an available specialized local suite.

## Expanded IDOR Results

The baseline expanded security suite executed 4/4 and passed. Storage cross-user and cross-tenant checks were attempted in the Storage API suite but authorized operations were blocked by the table permission failure.

## Clean-Orchestration Result

Clean reset remains flaky: the Supabase CLI can return Storage Gateway HTTP 502 during container restart. The stable-instance business results above are kept separate and are not downgraded to reset failures.

## Marketplace Decision

**NO.** Storage authorization has a real local failure, and required OMR, parent/outbox, signed URL, and concurrency matrices are incomplete.

## Exact root causes found

1. The fixture command was invoked immediately after `db reset` while GoTrue and Storage were still restarting. Auth admin calls could time out or return transient gateway failures. A fixed three-second wait was insufficient and could leave a stale or missing fixture manifest.
2. `supabase status -o json` itself can return `LegacyStorageGatewayStatusError` / HTTP 502 during the post-reset Storage restart. This is a local service-readiness failure, not a business-logic pass.
3. The first matrix execution exposed a non-deterministic fixture selection: the start RPC returned the expired recovery attempt instead of `attemptActive`. The fixture now makes the active attempt deterministically newer.

## Implemented harness controls

- bounded retry around local `supabase status -o json`;
- finite Auth health polling with explicit `AUTH SERVICE NOT READY` failure;
- bounded Auth admin call timeouts;
- reuse/update of deterministic Auth users rather than stale password assumptions;
- four real session validations: Student A, Student B, Teacher A, Parent A;
- manifest now includes Student B’s token for cross-tenant tests;
- `security/harness-smoke-local.mjs` verifies all four sessions, an authenticated DB read, and a responding Storage endpoint;
- stale fixture manifest is removed before reset;
- the single `npm run test:runtime:local` command invokes smoke, runtime, and IDOR suites.

## Observed execution results

- Harness smoke: **PASS** in the completed fixture run: 4 authenticated sessions, authenticated DB call, Storage endpoint response.
- Runtime matrix: **STARTED**, then failed on a fixture determinism assertion before the fixture timestamp correction; this was a harness fixture failure, not a product result.
- Subsequent full runs reached local container restart but were blocked by transient Storage Gateway HTTP 502 from the Supabase CLI reset/status lifecycle. They did not execute the required matrix on that run.
- No required test is silently skipped by the repaired local orchestrator; a precondition failure exits non-zero.

## Classification

| Area | Status | Evidence |
|---|---|---|
| Auth/DB/Storage harness smoke | IMPLEMENTED BUT NOT VERIFIED consistently | One full smoke PASS; later reset lifecycle blocked by Storage 502 |
| Runtime business matrix | PARTIALLY WORKING | It began and caught a deterministic fixture defect; later run blocked before matrix |
| Expanded IDOR suite | IMPLEMENTED BUT NOT VERIFIED in the final clean run | Wired into orchestrator, but final clean run did not reach it |
| Offline recovery | IMPLEMENTED BUT NOT VERIFIED in final clean run | Existing matrix cases remain wired |
| Parent notification | IMPLEMENTED BUT NOT VERIFIED | Requires complete publication/outbox execution and provider/staging validation |
| OMR and OMR grading | IMPLEMENTED BUT NOT VERIFIED | Requires worker/provider and live fixture execution |
| Tutor Storage/RLS/signed URLs | IMPLEMENTED BUT NOT VERIFIED | Smoke confirms endpoint response only, not full ownership/expiry matrix |
| Concurrency | NOT EXECUTED | No completed run reached the relevant suite |

## Remaining blockers

- Local Supabase CLI reset has a transient Storage Gateway 502 during container restart; the retry is bounded and fails closed after three attempts.
- A clean successful run of the entire matrix is still required before claiming Phase 8.5 completion.
- Staging execution remains required for provider delivery, worker behavior, cross-tenant authorization, signed URL expiry, and concurrency.

## Correct completion status

**PHASE 8.5 IS NOT COMPLETE.** The harness repair is implemented. Current evidence supports **PARTIALLY WORKING / IMPLEMENTED BUT NOT VERIFIED**, not 100% completion.

## Proven Storage Authorization Bug

The original Storage policies directly queried `public.tutor_conversations` while evaluating `storage.objects`, producing `permission denied for table tutor_conversations` for authorized operations.

## Storage Fix

Added forward migration `20260919120000_phase8_5_tutor_storage_authorization_fix.sql` with narrowly scoped `SECURITY DEFINER` boolean helpers, explicit `search_path`, restricted execution, and private-bucket policies preserving owner/staff tenant boundaries.

## Storage Regression Matrix

33 assertions executed: **33 PASS, 0 FAIL**.

## Signed URL Matrix

Immediate signed URL access and expiry passed in the Storage suite. Dedicated path-manipulation and nonexistent-object cases remain incomplete.

## Parent Notification Matrix

Not independently executed; publication and idempotent retry passed, but notification counts were not inspected.

## Outbox Matrix

Not independently executed; no provider delivery was invoked.

## OMR Approval Matrix

Not executed as a complete local runtime suite.

## OMR-to-Grading Runtime Proof

Not executed; no claim is made that approved OMR data affected authoritative grading.

## Concurrency Matrix

Submission, grading, publication, OMR, and certificate concurrency were not executed.

## Expanded IDOR

Baseline expanded suite: **4/4 PASS**. Dedicated teacher/parent/signed-URL cases remain incomplete.

## Remaining Staging Verification

OpenAI, Twilio, external OMR worker, browser Tutor audio, Deno, and Python tests remain external-only. Local gaps are notification/outbox inspection, OMR integration, concurrency, and dedicated signed-URL authorization.

## Marketplace Gate

**NO.** Storage regression is green, but all required OMR, notification/outbox, concurrency, and expanded authorization matrices have not executed.

## Final Signed URL Authorization Matrix

Storage suite signed URL checks: immediate owner access PASS; expiry safe failure PASS. Dedicated owner/other-user/cross-tenant/path-manipulation cases were not separately available.

## Parent Notification Runtime Matrix

NOT EXECUTED. No dedicated Parent A/Parent B notification-count suite exists in the current harness.

## Parent IDOR

NOT EXECUTED as a dedicated runtime suite. Baseline IDOR remains 4/4 PASS.

## Outbox Idempotency

NOT EXECUTED. No local outbox-count suite was available.

## OMR Runtime Matrix

HARNESS_ERROR: `omr-workflow-api-test.mjs` stopped before behavior because a fixture cleanup query received an undefined UUID. No OMR PASS/FAIL is claimed.

## OMR-to-Grading Proof

NOT EXECUTED. No authoritative OMR-to-score chain was asserted.

## Submission Concurrency

NOT EXECUTED.

## Grading Concurrency

NOT EXECUTED. The available grading API suite failed during setup because it directly inserted an attempt and was denied by RLS.

## Publication Concurrency

NOT EXECUTED.

## OMR Concurrency

NOT EXECUTED.

## Certificate Concurrency

NOT EXECUTED.

## Final Targeted IDOR

Baseline targeted security suite: 4 PASS, 0 FAIL. Parent/OMR/signed-URL targeted additions were not available as executable cases.

## Local Phase Closure

Phase 8.5 remains open. Stable local verification confirms Storage 33/33, runtime 16/16, and baseline IDOR 4/4, but the final academic gates are incomplete.

## Staging Verification Checklist

Execute dedicated parent/outbox, OMR approval-to-grading, all concurrency, and targeted signed-URL/parent/teacher IDOR suites after their fixtures are implemented. External provider and worker checks remain staging-only.

## Marketplace Gate

**NO** until the remaining local academic/security gates execute without HARNESS_ERROR and pass.

## OMR Integration Root Cause

The original fixture omitted `omr_results.student_profile_id`; this was corrected so the result now contains deterministic student, exam, institution, and question relationships. After that correction, the approval path still failed to persist an `exam_attempt_id` for the newly created OMR result. The failure is therefore no longer a fixture UUID or RLS setup error; it is an actual OMR approval integration failure.

## Authoritative OMR Attempt Model

The existing RPC is designed to reuse an un published attempt or create a submitted attempt when none exists, then write to `answers` and link `omr_results.exam_attempt_id`. The executed result did not satisfy that contract.

## OMR-to-Grading Repair

Not applied. A forward production migration would be required after tracing the no-link RPC path; no speculative grading change was made.

## OMR Runtime Matrix

Fixture prechecks and authenticated review path were reached. Approval-to-attempt linking failed; remaining OMR cases were stopped to avoid reporting invalid downstream assertions.

## OMR Audit Proof

Not completed because approval did not produce the authoritative linked attempt required for the post-approval audit proof.

## OMR Concurrency

NOT EXECUTED.

## Parent Notification Results

NOT EXECUTED.

## Parent IDOR Results

NOT EXECUTED as a dedicated suite.

## Publication/Outbox Results

Sequential publication remains previously verified; parent/outbox count and concurrent publication tests remain unexecuted.

## Concurrency Results

NOT EXECUTED.

## Signed URL Final Matrix

Existing baseline: 2/2 PASS. Missing targeted authorization cases remain unexecuted.

## Targeted IDOR

Baseline: 4/4 PASS. Missing parent/OMR/publication/certificate/signed-URL cases remain unexecuted.

## Marketplace Gate

**NO.** The corrected relational OMR fixture still fails the authoritative OMR-to-attempt link, and the remaining parent/outbox/concurrency gates are incomplete.

## OMR Harness Error Root Cause

The OMR test expected `approve_omr_result` to return an array and then read `exam_attempt_id`; the authoritative RPC path returned `null` without an error, so no linked attempt ID was available. The fixture UUIDs themselves are generated deterministically and relationally valid; the failing value was the RPC response-derived `attemptId`, not a random fixture UUID.

## Grading RLS Harness Error Root Cause

The grading test directly inserted `exam_attempts` through the client. RLS correctly denied that setup operation. The harness now uses authenticated `start_exam_attempt` for runtime behavior; admin SQL is reserved for prerequisite fixture provisioning.

## Fixture Boundary

Admin/service credentials provision deterministic institutions, profiles, questions, exams, and stored OMR prerequisites. Student/teacher/parent runtime actions use real authenticated sessions and RPCs. No RLS was disabled.

## Parent Notification Results

NOT EXECUTED: no dedicated parent-count suite exists.

## Outbox Results

NOT APPLICABLE as an executable local suite: no dedicated outbox-count/retry harness exists; Twilio was not called.

## Parent IDOR Results

NOT EXECUTED as a dedicated suite; baseline IDOR remains 4/4 PASS.

## OMR Runtime Results

HARNESS_ERROR before matrix completion: `approve_omr_result_idempotent` returned no linked `exam_attempt_id` after the correction path. This is now recorded as a candidate real product/RPC integration defect requiring focused diagnosis, not silently counted as PASS.

## OMR-to-Grading Proof

FAIL/UNPROVEN: the approval response did not provide a linked attempt, so the persisted OMR-to-authoritative-score chain could not be demonstrated.

## Concurrency Results

NOT EXECUTED: no dedicated local concurrency suites are present.

## Final Signed URL Authorization

Existing Storage suite signed URL owner/expiry assertions remain PASS; targeted cross-user/path cases are not separately implemented.

## Final Targeted IDOR

Baseline 4/4 PASS. Parent/OMR/publication/certificate/signed-URL targeted additions remain unexecuted.

## Marketplace Gate

**NO.** OMR approval-to-grading is currently blocked by the observed null RPC linkage, and parent/outbox, concurrency, and targeted IDOR suites remain incomplete.

## OMR Authoritative Integration Repair — Final Local Run

This addendum supersedes the earlier OMR-null-linkage entries above. Only the OMR integration harness and its directly related grading setup were addressed in this run. No Marketplace, parent/outbox, signed-URL, or unrelated concurrency suite was executed.

## Confirmed OMR Integration Defect

No production defect was confirmed. The earlier reported null link was caused by the harness reading the RPC response as an array without using the persisted `omr_results.exam_attempt_id` fallback, combined with an invalid “confident” fixture: a blank answer was normalized by the fail-closed OMR trigger to `needs_manual_review = true`. The fixture now uses deterministic relational IDs and a confident objective answer for the non-review item.

## Exact SQL/RPC Root Cause

The responsible authoritative path is `public.approve_omr_result_idempotent(uuid, uuid)`, which locks the result and delegates to `public.approve_omr_result(uuid, uuid)`. The underlying function intentionally refuses approval while unresolved `omr_answers.needs_manual_review` rows remain. Its intended successful branch reuses an existing unpublished attempt or creates a submitted attempt, writes canonical `public.answers`, calculates score from `exam_questions`/`question_options`, then persists `omr_results.exam_attempt_id`.

## Intended OMR Attempt Model

Hybrid server-authoritative model: reuse the student’s existing unpublished attempt for the exam when present; otherwise create the paper/OMR attempt inside the authorized RPC. The browser never creates or selects the authoritative attempt ID.

## Fix Implemented

Harness-only. `omr-workflow-api-test.mjs` now supplies `student_profile_id`, links deterministic exam/question/option/tenant rows, uses admin credentials only for fixture provisioning, uses the real `resolve_omr_answer` and idempotent approval RPCs for runtime behavior, and performs a relational precheck before authorization/approval assertions. `exam-grading-api-test.mjs` now provisions attempts through `start_exam_attempt` rather than a client-side insert. No production source or OMR migration changed.

## Transaction/Invariants

The successful local run preserved one linked attempt, two canonical answers, the weighted score, unpublished state before publication, and stable counts after repeat approval. The existing RPC transaction and row locks provided the observed atomic/idempotent behavior.

## Before Runtime State

For the new OMR fixture, `omr_results.exam_attempt_id` was `NULL`; source rows had aligned institution, exam, student, bubble-sheet, and question mappings, with exactly one unresolved ambiguous answer.

## After Runtime State

`omr_results.exam_attempt_id` became a valid UUID. The authoritative attempt was `graded`, score `2.00`, percentage `40.00`, and unpublished; `public.answers` contained exactly two rows totaling `2.00` awarded points. Publication through `publish_exam_result` then made the result visible to Student A.

## OMR-to-Grading Proof

PASS locally: stored extraction → authorized manual correction → `approve_omr_result_idempotent` → authoritative attempt → canonical answers → objective score `2/5` → `graded` eligibility → publish RPC → student-visible published result.

## OMR Audit Proof

The runtime assertions verified source extraction and review state before approval, correction success, persisted attempt linkage, canonical answer count/points, and unchanged legacy tables. A dedicated immutable audit-event-row assertion for reviewer/timestamp/raw extraction fields was not executed; therefore the full audit requirement remains unverified.

## OMR Idempotency

PASS: the second idempotent approval returned successfully without creating another attempt or answer; counts remained `1` attempt and `2` answers.

## OMR Concurrency

NOT EXECUTED in this OMR-only repair run. No claim is made for simultaneous approval requests.

## OMR Rollback

NOT EXECUTED as a fault-injection test. The successful transaction-level invariants were observed, but a forced mid-transaction rollback test remains required.

## OMR IDOR

PASS for the executed cases: Student A cannot read/approve the OMR result, and Institution B cannot approve Institution A’s result. Broader targeted IDOR additions were intentionally not run.

## Grading Harness Boundary

The prior RLS setup error was a direct client insert into `exam_attempts`; RLS correctly denied it. Infrastructure fixtures are provisioned through controlled local admin SQL. Runtime submission uses the authenticated student and `start_exam_attempt`; runtime grading behavior must use authenticated staff RPCs. RLS was not disabled and service-role/admin credentials were not used to prove runtime authorization.

## Grading Harness Result

The directly related grading suite executed `12` assertions: `8 PASS`, `4 FAIL`. The four failures are stale expectation mismatches (`graded` versus expected `approved`, and repeat submission accepted/idempotent versus expected error); no OMR production change was made from them. The OMR integration result is independent and passed `19/19`.

## Remaining Final Gates

OMR simultaneous-concurrency, forced rollback, and dedicated immutable audit-field checks remain unexecuted. Parent/outbox, broad signed-URL, unrelated concurrency, and Marketplace checks were intentionally left untouched per scope.

## Grading Stale Expectation Investigation — Final

The four previous grading failures were all **STALE TEST EXPECTATION** cases. MCQ-correct, MCQ-wrong, and true/false submissions correctly return `graded` under the Phase 7 `submit_exam_attempt` contract, not `approved`; scores and pass flags were correct. Repeat submission is intentionally idempotent and returns the existing graded result without duplication. Updated result: **12/12 PASS**.

## OMR Audit Runtime Proof

PASS. Persisted rows retained original detected answer `A`, confidence `0.42`, ambiguity state, manual correction `B`, reviewer identity, and review/approval timestamps after correction and approval.

## OMR Concurrency Runtime Proof

PASS. Two simultaneous authenticated Teacher A approvals on a fresh isolated result converged to exactly one authoritative attempt, two answers, score `2.00`, and `approved` status, with no duplicate answers or doubled score. Migration `20260919130000_phase8_5_omr_approval_concurrency.sql` adds transaction-scoped advisory serialization keyed by OMR result ID.

## OMR Rollback Runtime Proof

PASS. A deliberately invalid linked-attempt fixture reached the approval transaction and failed safely. The result remained `processed`, no authoritative answers or score survived, the attempt remained `submitted`, and original extraction remained intact.

## OMR Final Local Status

**OMR LOCAL BUSINESS LOGIC VERIFIED.** Core approval/linkage/grading, audit evidence, concurrency, rollback, sequential idempotency, and cross-tenant authorization passed. Focused OMR result: **24 PASS / 0 FAIL / 0 HARNESS_ERROR**.

## Remaining Cross-Module Gates

Phase 8 is not fully verified. Remaining gates are parent notification, Parent IDOR, publication/outbox counts, non-OMR submission/grading/publication concurrency, certificate concurrency, full signed-URL authorization, and final targeted IDOR. External-only checks remain OpenAI, Twilio, external OMR worker, browser Tutor audio, Deno, and Python pytest.

## Parent Publication & Notification

PASS locally. Authoritative `publish_exam_result` produced publication event count `1`, Parent A notification count `1`, and zero Tenant B leakage. Notification data referenced the correct student, exam, attempt/result, and score. Repeat publication retained event count `1` and notification count `1`.

## Parent IDOR

PASS for executed paths: Parent A could read the own-child notification and received no Student B notification. A symmetric Parent B session was not provisioned and is not claimed.

## Publication Idempotency

PASS sequentially. The repeat publication call retained one published state, one publication event, and one Parent A notification.

## Publication Concurrency

NOT EXECUTED; no dedicated fresh parallel publication harness was available.

## Submission Concurrency

NOT EXECUTED.

## Grading Concurrency

NOT EXECUTED; grading core remains locally verified by the 12/12 API suite.

## Certificate Concurrency

NOT EXECUTED; sequential certificate lifecycle remains locally verified.

## Signed URL Complete Authorization

NOT EXECUTED as a new complete matrix. Existing Storage baseline remains 33/33 and signed-URL baseline 2/2; dedicated Tutor owner/cross-user/path cases remain pending.

## Final Targeted IDOR

Parent own-child/Student-B denial passed. Teacher cross-tenant publication/certificate issuance and explicit cross-user Tutor signed-URL generation were not executed.

## Phase 7 Local Closure

**PHASE 7 — LOCAL BUSINESS LOGIC VERIFIED** for offline recovery, grading, sequential publication idempotency, and the executed Parent notification/IDOR paths. Concurrency coverage remains incomplete.

## Phase 8 Local Closure

**PHASE 8 — CORE OMR/GRADING LOCALLY VERIFIED; FINAL CROSS-MODULE GATES PENDING.** OMR, audit, rollback, OMR concurrency, grading, and Storage baselines are verified.

## Marketplace Gate

**NO.** Marketplace was not started because publication/submission/grading/certificate concurrency, complete signed-URL authorization, and final targeted teacher/storage IDOR remain unexecuted.

## Submission Concurrency — Final Integrity Gate

PASS. Two simultaneous authenticated Student A submissions converged to one finalized `graded` attempt and one answer row with no score duplication.

## Grading Concurrency — Final Integrity Gate

PASS. Two simultaneous authorized Teacher A `record_manual_exam_grade` calls produced one coherent `graded|10.00` authoritative attempt row. The database row lock serializes the updates; identical payloads are safe.

## Publication Concurrency — Final Integrity Gate

PASS. Two simultaneous Teacher A publication calls produced `true|1|1`: one published result, one `result_publication_events` row, and one Parent A notification.

## Certificate Concurrency — Final Integrity Gate

PASS. Two simultaneous certificate issuance calls produced one certificate row and one unique credential identifier. Sequential lifecycle verification was not repeated.

## Signed URL Final Authorization Matrix

Focused local result: **6/6 PASS** — owner generation, valid consumption, cross-user generation denial, unauthenticated denial, nonexistent-object safe denial, and expiry. Cross-user/unauthenticated denials returned safe `Object not found`; no URL was issued. The full 11-case matrix, including staff authorization and all path-normalization variants, remains pending.

## Final Teacher IDOR

The executed teacher cross-tenant certificate request was denied (`student_not_found`). Tenant B publication denial was not executed in this focused run; OMR cross-tenant denial remains previously verified.

## Final Storage IDOR

PASS for the executed known-owner cross-user signed-URL generation case. The other-user request received safe denial and no signed URL.

## Phase 7 Final Local Status

**PHASE 7 — LOCAL BUSINESS LOGIC VERIFIED.** Offline recovery, grading, Parent notification/IDOR, sequential publication, submission concurrency, grading concurrency, and publication concurrency passed locally.

## Phase 8 Final Local Status

**PHASE 8 — CORE OMR/GRADING LOCALLY VERIFIED; FINAL AUTHORIZATION GATES PENDING.** OMR and certificate concurrency passed, but complete signed-URL authorization and targeted Teacher publication IDOR are not yet fully executed.

## Marketplace Development Gate

**NO.** Marketplace was not started. Remaining local blockers are the unexecuted full signed-URL/path matrix and Tenant B publication IDOR; no new P0/P1 product failure was found in this gate.

## Tenant B Publication IDOR — Final

PASS. Authenticated Tenant A Teacher A called the real `publish_exam_result` RPC for a fully graded Tenant B attempt and received `publication_institution_denied`. The attempt remained unpublished; publication events and Parent B notifications remained `0`. An authorized Tenant B School Admin sanity call succeeded.

## Signed URL Existing Coverage

The prior six focused cases were owner generation, valid consumption, cross-user denial, unauthenticated denial, nonexistent-object denial, and expiry. All remained passing.

## Signed URL Path Manipulation Matrix

Final focused result: **11 applicable cases, 11 PASS, 0 FAIL**. Cases covered owner, staff, same-tenant unrelated Parent A, cross-tenant Student B, unauthenticated, known other-user path, manipulated conversation path, sibling path, nonexistent object, valid consumption, and expiry. Encoded owner-path normalization remained within owner authorization.

## Final Authorization Verdict

Tenant B publication IDOR and all applicable signed-URL authorization/path cases passed locally. No unauthorized signed URL was generated and no cross-tenant publication occurred.

## Phase 8 Final Local Status

**PHASE 8 — LOCAL BUSINESS LOGIC VERIFIED.** OMR, grading, certificate concurrency, Storage authorization, signed-URL authorization, and targeted teacher/storage IDOR gates are locally verified. External provider/runtime checks remain staging-only.

## Marketplace Gate

**CAN MARKETPLACE BEGIN? YES.** Phase 7 and Phase 8 local business/security gates are closed with no unexplained local P0/P1 defect. Marketplace was not started automatically.
