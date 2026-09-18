# PHASE A.2 — MCQ INVARIANT + RUNTIME ACCEPTANCE REPORT

## Status

PARTIAL — local invariant and Phase A runtime checks pass; not ready for Phase B.

## Product Invariant

`multiple_choice` and `true_false` require exactly one `question_options.is_correct = true`.
The new deferred server trigger raises `MCQ_REQUIRES_EXACTLY_ONE_CORRECT_OPTION` and is not executable by client roles.

## Historical Data Risk

No historical rows were backfilled or changed. Existing invalid rows are not silently repaired; an inventory and remediation decision is still required before production rollout.

## Files Changed

- `supabase/migrations/20260922120000_phase_a_single_answer_invariant.sql`
- `supabase/migrations/20260922110000_phase_a_omr_eligibility_snapshot_contract.sql`
- `security/phase-a-runtime-verification.sql`
- `security/phase-a-single-answer-invariant-static.test.mjs`
- `package.json` (focused `test:phase-a-invariant` script already present)

The local migration chain also required normalizing malformed literal `\\n` text in seven untracked migration copies and temporarily isolating three duplicate early migrations during reset; those copies were restored. No remote database was touched.

## Migration Runtime

The local schema reset loaded the Phase A migrations and the Phase A.2 trigger. The CLI reset reported a local Storage gateway 502 during post-reset bucket reconciliation, but the database schema was loaded and the SQL harness executed successfully afterward.

## MCQ Write Invariant Runtime Tests

PASS: valid multiple-choice exactly-one.

PASS: valid true/false exactly-one.

PASS: zero-correct multiple-choice rejected.

PASS: two-correct multiple-choice rejected.

PASS: zero-correct true/false rejected.

PASS: two-correct true/false rejected.

## Phase A Runtime Cases

The self-contained harness completed with exit code 0 and rolled back all fixtures. Valid exact snapshot finalization, authoritative question/option rejection matrix, transaction atomicity, relationship checks, finalized immutability, draft cascade, cross-institution rejection, and legacy compatibility all passed.

## Mixed Exam Stored Evidence

The harness rejected mixed source option counts and incorrect `choices_count` values before finalization after the source-contract check was completed.

## Authorization / Tenant Isolation

Synthetic tenant A/B staff fixtures were used. Cross-institution staff rejection passed. The SQL session cannot prove PostgREST anon EXECUTE privileges; the harness records this as `BLOCKED_EXTERNAL` while function-level anonymous rejection passed.

## Immutability

Finalized parent/section/question/option mutations and finalized deletion were rejected; draft child deletion cascaded.

## Retry / Idempotency Behavior

The snapshot RPC has no explicit request idempotency key. A repeated identical payload is protected by the unique QR token only when the same token is reused; separate generated QR tokens create separate templates. This needs an explicit product decision before Phase B.

## RPC Exposure

Phase A snapshot execution remains granted to `authenticated` and is server-authorized by staff role and institution. The Phase A.2 validation helpers have client EXECUTE revoked.

## Legacy Compatibility

Legacy bubble-sheet rows remain represented by the legacy default state and were not backfilled.

## Static / Build Verification

- Phase A.2 focused static tests: 2 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run build`: passed; existing bundle-size, Browserslist, and Mammoth `eval` warnings remain.
- `npm run test:security`: 89 passed, 0 failed, 4 skipped for unavailable isolated staging fixtures.

## Failures / Skips

The four existing live IDOR tests remain skipped because their staging fixture variables are unavailable. The CLI reset's local Storage 502 is an environment limitation, not a database migration failure.

## Remaining Work

Before Phase B, convert every direct MCQ/true-false write path to an atomic server path, decide how zero-option creation is prevented without breaking authoring, inventory historical invalid questions, and add a real PostgREST-role runtime check for EXECUTE grants.

## Verdict

NOT READY FOR PHASE B
