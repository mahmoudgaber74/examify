# Grade Publication Architecture Review

Date: 2026-09-05  
Status: investigation/design only; no publication refactor was performed in Phase 2A.

## Current exact flow

- `src/views/Grading.tsx` directly updates `exam_attempts` to `status = 'approved'`, `is_result_published = true`, and approval metadata. It then invokes `whatsapp-notification` separately.
- `src/views/ExamResults.tsx` has a second direct update path. It does not currently set `approved_by`, then separately invokes the same Edge Function.
- `src/views/Grading.tsx` also directly reverses publication for review.
- `20260825130000_secure_user_notifications.sql` has a database trigger that inserts an in-app student notification on the false-to-true publication transition.
- `whatsapp-notification` discovers linked parents, creates parent notifications, and optionally calls Twilio. A successful grade update therefore does not guarantee provider delivery; current UI paths log notification errors rather than rolling back the grade.

## Risks

Two clients can publish the same attempt, notification calls can be duplicated, and a provider failure is not represented by a durable retry/outbox record. Authorization currently depends on the effective RLS state plus the protected function, rather than one auditable state transition.

## Recommended Phase 2B design

1. Add an authorized `publish_exam_attempt_result(p_attempt_id, p_idempotency_key)` RPC. It must lock the attempt, verify staff role and institution, require a fully graded state, validate score state, and atomically set approval fields.
2. Insert a unique publication event/outbox record keyed by attempt and publication transition. The RPC must return the existing event on an idempotent retry.
3. Deliver in-app and WhatsApp notifications from the event worker/function, recording `pending`, `sent`, and `failed` states with bounded retries. Parent linkage and provider configuration must be checked server-side.
4. Add an authorized `unpublish_exam_attempt_result` RPC requiring an audit reason; it should create a reversal event and never erase the original publication audit record.
5. Change both views to call the RPC only. Do not grant the browser direct authority to mutate publication fields.

This is deliberately deferred: changing grade visibility and notification semantics requires staging fixtures, migration-order verification, and a product decision on whether unpublish is allowed after parent delivery.

