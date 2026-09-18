# Phase 7 Exam Lifecycle Report

## Scope

This phase hardens the exam lifecycle from availability and attempt creation through grading, publication, and parent notification. The local Supabase database and staging credentials were unavailable, so this report distinguishes source implementation from runtime verification.

## Implemented changes

- Added `start_exam_attempt()` as a server-authoritative, locked, assignment-aware and max-attempt-aware start path.
- Added a forward migration restricting browser writes to active student attempts and hiding unpublished results from students.
- Added protected RPCs for manual grading, exam publication, result publication, and returning a result to review.
- Added `result_publication_events` with one event per attempt and a dedupe key for parent notifications.
- Routed ExamRunner start, ExamBuilder publish, Grading, and ExamResults publication through RPCs.
- Updated the WhatsApp Edge Function to derive publication content from the server event and to upsert parent notifications idempotently.
- Added static Phase 7 lifecycle tests.

## Status matrix

| Area | Status | Evidence | Missing verification |
|---|---|---|---|
| Exam availability and assignment checks | IMPLEMENTED BUT NOT VERIFIED | `start_exam_attempt()` | Live RLS/RPC test with assigned and unassigned students |
| Concurrent attempt creation | IMPLEMENTED BUT NOT VERIFIED | exam row lock and existing in-progress reuse | Concurrent staging requests |
| Client attempt creation | VERIFIED WORKING (static) | `ExamRunner.tsx` calls `start_exam_attempt` | Browser + database execution |
| Student answer ownership | IMPLEMENTED BUT NOT VERIFIED | `answers_update` policy and attempt ownership | Cross-user staging mutation test |
| Authoritative submit/idempotency | PARTIALLY WORKING | wrapper locks and returns submitted attempts | Expired offline auto-submit still calls the legacy function, whose historical exam-window check can reject after `end_at` |
| Manual grading bounds/authorization | IMPLEMENTED BUT NOT VERIFIED | `record_manual_exam_grade()` | Teacher/grader tenant and score-boundary tests |
| Exam publication | VERIFIED WORKING (static) | `publish_exam()` RPC and ExamBuilder route | Live schema/RLS execution |
| Result publication | IMPLEMENTED BUT NOT VERIFIED | `publish_exam_result()` and event insert | Live transaction and repeat-publication test |
| Student unpublished-result visibility | IMPLEMENTED BUT NOT VERIFIED | revised `exam_attempts_select` policy | Live student A/B visibility test |
| Parent notification idempotency | IMPLEMENTED BUT NOT VERIFIED | event-derived Edge Function and unique dedupe key | Live parent-link, retry, and Twilio tests |
| Audit trail | IMPLEMENTED BUT NOT VERIFIED | audit inserts in grade/publish/unpublish RPCs | Live audit row verification |

## Correct Phase 7 status

**PHASE 7 IMPLEMENTATION COMPLETE — RUNTIME VERIFICATION PENDING**. Phase 7.1 adds a server-issued effective deadline and one-time recovery capability so queued automatic delivery no longer depends on the legacy `end_at` predicate. Live Supabase, browser, concurrency, and security verification remain pending.
