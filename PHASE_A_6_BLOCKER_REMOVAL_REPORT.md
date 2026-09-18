# PHASE A.6 — BLOCKER REMOVAL REPORT

## Status

COMPLETE for isolated local verification. Cloud deployment remains pending review.

## Idempotency Conflict Precedence

`create_exact_bubble_sheet_snapshot_idempotent(jsonb)` now acquires the
institution/exam/request transaction lock and checks an existing request key
before delegating to the normal snapshot RPC. An exact semantic retry returns
the existing snapshot. A different semantic request with the same key raises
`OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT`. A new key is validated against the
authoritative source and creates a new snapshot.

The fingerprint is server-authoritative: it contains the database exam,
institution, canonical exam-question identity/order/type/points, canonical
option identity/order, and the normalized request identity/order/count fields.
QR tokens, geometry, section presentation, JSON key ordering, and other
UI-only output values are excluded from the semantic comparison.

## Source-Edit Compatibility

`20260922150000_phase_a_6_source_edit_compatibility.sql` restores the composite
snapshot option foreign key with `ON DELETE RESTRICT` and adds the narrowly
scoped `update_single_answer_question_options(uuid, jsonb)` authoring RPC.
The RPC updates existing objective option rows in place, preserving option
identity and finalized snapshot immutability while allowing a legitimate
source edit for the V1/V2 acceptance proof. It is authenticated staff-only,
institution-scoped, and does not change option cardinality.

## Runtime Results

The real local HTTP runtime harness passed:

- concurrent K1 callers: 2; resulting snapshot rows: 1; both responses resolved to the same snapshot ID;
- V1/V2 source edit: V1 remained immutable, V2 reflected the source option edit, and a retry of K2 reused V2;
- original Phase A runtime: all executable assertions passed and the transaction rolled back;
- PostgREST/JWT checks: 6 passed, including anonymous rejection, cross-tenant rejection, and direct option-write protections.

The original Phase A SQL harness also passed the exact-source matrix. Its
anonymous EXECUTE notice remains `BLOCKED_EXTERNAL` because a SQL session
cannot simulate PostgREST's anonymous role; the separate HTTP harness covers
that boundary.

## Exact-Source Negative Matrix

The runtime harness executed and rejected all of these cases:

| Case | Observed specific result |
|---|---|
| missing authoritative question | `omr_template_eligible_question_count_mismatch` |
| extra non-exam question | `omr_template_question_source_mismatch` |
| duplicate question | `omr_template_exam_question_duplicate` |
| wrong question order/number | `omr_template_question_source_mismatch` |
| missing option | `omr_template_option_source_mismatch` |
| extra option | `omr_template_option_order_mismatch` |
| duplicate option | `omr_template_option_source_mismatch` |
| wrong option order | `omr_template_option_order_mismatch` |
| mixed source option counts | `omr_template_exam_option_count_mixed` |
| incorrect choices count | `omr_template_choices_count_mismatch` |
| conflicting request key | `OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT` |

The valid complete authoritative snapshot passed and finalized.

## Migration Inventory and Reset Proof

There are 100 migration files on disk in the current worktree. Three
untracked `2026080215*...sql.sql` artifacts were excluded from the isolated
canonical reset because they are duplicate/naming-anomaly files and one
depends on a function not present at its position. The remaining 97 ordered
migrations, including Phase A through A.6, were applied successfully in a
fresh temporary Supabase project. The temporary database was not the
production or Cloud database.

Other untracked forward migrations currently present in the worktree were
included as part of the current forward chain. They should still be reconciled
against the Cloud migration history before any push. No previously applied
migration was edited by this phase.

## Security and Integrity Assessment

- The idempotent RPC remains `SECURITY DEFINER` with `search_path = public, pg_temp`.
- Its EXECUTE privilege is revoked from `PUBLIC` and `anon`, and granted to `authenticated` only.
- Existing exact-snapshot authorization remains delegated to the original staff/institution checks.
- The source-edit RPC requires an authenticated staff role and the current institution; teachers must pass the existing question-management authorization.
- The option foreign key and `ON DELETE RESTRICT` prevent finalized snapshot option mappings from becoming invalid through source deletion.
- No service-role path, RLS bypass for clients, answer-key exposure, or authorization broadening was added.

## Regression Gates

- Phase A static/focused tests: PASS.
- Phase A.6 focused static tests: 2/2 PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; existing Browserslist, bundle-size, and Mammoth eval warnings remain.
- `npm run lint`: PASS; 30 existing warnings, 0 errors.
- `npm run test:security`: 91 passed, 0 failed, 4 pre-existing fixture-dependent tests skipped.
- Phase A.6 concurrent/V1/V2 runtime: PASS.
- Phase A PostgREST runtime: 6 passed, 0 failed.

## Phase 7 and Phase 8 Status

Based on the current project audit record, Phase 7 is implemented but its
external/staging runtime evidence remains pending. Phase 8 is implemented
with local migration/static coverage, while provider/worker and staging
runtime evidence remains pending. Neither phase is claimed as fully Cloud
accepted by this local report.

## Remaining External-Only Verification

- Cloud migration-history reconciliation and isolated Cloud migration review;
- Cloud runtime verification with approved non-production fixtures;
- external OMR worker/provider behavior;
- Twilio delivery and scheduler observation;
- browser/device-specific OMR and proctoring checks.

## Marketplace Gate

No Marketplace work was started by this phase. Local Phase A.6 is ready for
the next planned phase only after Cloud migration review and the remaining
external checks are separately approved.

## Files Changed in This Phase

- `supabase/migrations/20260922140000_phase_a_4_snapshot_idempotency.sql`
- `supabase/migrations/20260922150000_phase_a_6_source_edit_compatibility.sql`
- `security/phase-a-runtime-verification.sql`
- `security/phase-a-4-acceptance-static.test.mjs`
- `security/phase-a-6-runtime.mjs`
- `security/phase-a-6-static.test.mjs`
- `package.json`
- `PHASE_A_6_BLOCKER_REMOVAL_REPORT.md`

No frontend, Cloud database, deployment, scheduler, provider, or Marketplace
changes were made by Phase A.6.

## Final Decision

LOCAL PHASE A.6: READY FOR REVIEW.

CLOUD: DO NOT DEPLOY YET.
