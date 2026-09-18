# PHASE A.3 — FINAL PHASE A CLOSURE REPORT

## Status

PARTIAL

## Migration History Audit

The following untracked local migration copies were normalized from literal `\\n` text to real line breaks so the local SQL parser could read them: `20260802154738_20260802000000_secure_rls_and_tenant_isolation.sql.sql`, `20260802154834_20260802010000_secure_rls_phase2_fix_remaining.sql.sql`, `20260802154848_20260802020000_secure_rls_phase3_cart_items.sql.sql`, `20260805160000_complete_ai_grading_workflow.sql`, `20260826204047_20260826_create_chat_and_adaptive_exams.sql`, `20260907100000_phase4_teacher_approved_ai_grading.sql`, and `20260917100000_phase8_grading_integrity.sql`. They were not tracked by git and have no repository history available. The first three duplicate early copies were temporarily isolated for reset and restored. Before any Cloud use, these artifacts must be reconciled against the authoritative migration history; do not assume this working tree is deployable.

The Phase A.3 behavior was added only as forward migration `20260922130000_phase_a_3_atomic_single_answer_writes.sql`. The earlier Phase A eligibility migration was updated to enforce mixed option-count and `choices_count` checks before insertion.

## Final Write Architecture

MCQ/True-False application authoring now targets `save_single_answer_question(...)` (with the existing MCQ RPC retained as a compatibility wrapper). The RPC commits question text/metadata and the complete option set in one server-side transaction. Direct objective question/option table writes are excluded by the new policies; non-objective question types retain their existing direct paths.

## Single-Answer Enforcement

The database uses a deferred trigger for option inserts/updates, the atomic RPC validates final option cardinality, and the OMR eligibility functions require exactly one correct option. Runtime local checks proved valid MCQ/TF, zero-correct, and two-correct cases.

## Direct REST Protection

The new policies exclude `multiple_choice` and `true_false` from direct authenticated question and option INSERT/UPDATE/DELETE paths. The atomic RPC is `SECURITY DEFINER`, uses `search_path = public, pg_temp`, requires an authenticated staff role, derives institution context, checks subject availability, and checks teacher subject scope. A real PostgREST JWT matrix was not completed.

## Historical Data Audit

The required audit categories are: zero/one options, zero/multiple correct options, duplicate/null ordering, and more than eight options. No Cloud historical data was inspected or claimed clean. Local synthetic fixtures were rolled back; a standalone historical audit query remains required before production rollout.

## PostgREST Authorization Runtime

| Actor | Operation | Expected | Actual | Status |
|---|---|---|---|---|
| local staff | valid atomic MCQ/TF write | allowed | static path verified; SQL invariant runtime passed | PASS/PARTIAL |
| local staff | zero or multiple correct | rejected | rejected by invariant trigger | PASS |
| anonymous | objective RPC/direct write | rejected | not run through real PostgREST JWT | NOT RUN |
| non-staff authenticated | objective RPC | rejected | not run through real PostgREST JWT | NOT RUN |
| tenant A staff | tenant B object | rejected | SQL Phase A cross-tenant check passed | PARTIAL |

## Snapshot Idempotency

No explicit request idempotency key exists. Reusing the same QR token is rejected by the unique token constraint; a newly generated token intentionally creates a new snapshot. This is safe against identical-token duplication but is not a full idempotent retry API.

## Source Change Immutability

Phase A runtime checks passed finalized parent/child mutation rejection and draft cascade behavior. A dedicated V1/source-edit/V2 runtime case was not added.

## Runtime Tests

| Case | Status |
|---|---|
| Valid MCQ create | PASS (invariant runtime) |
| MCQ zero correct | PASS — rejected |
| MCQ multiple correct | PASS — rejected |
| Valid True/False | PASS (invariant runtime) |
| TF zero correct | PASS — rejected |
| TF multiple correct | PASS — rejected |
| Phase A exact snapshot and original matrix | PASS — transaction rolled back |
| Mixed option count / choices count | PASS — rejected |
| Direct REST write attack matrix | NOT RUN |
| Snapshot retry/version matrix | PARTIAL |
| Historical invalid OMR eligibility matrix | NOT RUN |

## Original Phase A Regression

The local Phase A harness completed successfully with exit code 0. Valid finalization, authoritative source rejection, atomicity, relationship checks, immutability, draft cascade, cross-institution rejection, and legacy compatibility passed. Anonymous EXECUTE behavior through real REST remains `BLOCKED_EXTERNAL`.

## Quality Gates

- local reset: database migrations loaded; CLI post-reset storage reconciliation returned a local 502.
- full migrations: loaded through Phase A.3 when duplicate early copies were temporarily isolated.
- invariant tests: 2/2 PASS.
- Phase A runtime harness: PASS with rollback.
- PostgREST tests: NOT RUN.
- security suite: 89 PASS / 0 FAIL / 4 SKIP.
- typecheck: PASS.
- lint: PASS with 30 pre-existing warnings.
- build: PASS with existing bundle-size, Browserslist, and Mammoth `eval` warnings.

## Files Changed

### NEW FORWARD MIGRATIONS

- `supabase/migrations/20260922130000_phase_a_3_atomic_single_answer_writes.sql`

### APPLICATION FILES

- `src/views/QuestionBank.tsx`
- `src/views/ExamBuilder.tsx`
- `src/views/AiEngine.tsx`

### TEST FILES

- `security/phase-a-3-write-path-static.test.mjs`
- `security/phase-a-runtime-verification.sql`
- `security/phase-a-single-answer-invariant-static.test.mjs`
- `package.json`

### HISTORICAL MIGRATIONS

The untracked malformed local copies listed in Migration History Audit were normalized; they were not committed or deployed. This must be resolved before production migration review.

## Remaining Gaps

### FAIL

None observed in executed local invariant or Phase A harness cases.

### BLOCKED

- Real PostgREST actor/JWT authorization matrix.
- Cloud historical-data audit.
- Cloud/authoritative migration-history reconciliation.

### NOT RUN

- V1/source edit/V2 snapshot test.
- Full direct REST delete-last-correct matrix.
- Historical invalid-question eligibility matrix.

### SKIPPED

Four existing live security tests skipped because isolated staging fixtures were unavailable.

## Verdict

NOT READY FOR PHASE B
