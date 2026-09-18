# PHASE B — SNAPSHOT-DRIVEN BUBBLE SHEET LAYOUT REPORT

## Previous Layout Problems

The legacy renderer treated a global `choices_count` and client-side mutable
exam structure as layout authority. That model cannot represent mixed MCQ4/TF2
layouts safely and could render a PDF from data that was not the finalized
server snapshot. Legacy templates remain supported under their existing
uniform-count contract.

## Final Layout Architecture (`Finalized Snapshot → Serialized Layout Model → PDF/Print Renderer`)

The current v2 generation path loads the authoritative eligible exam
questions/options, creates and finalizes a relational snapshot through the
server RPC, reloads that finalized snapshot, converts it to a typed layout
model, and only then renders the PDF. After finalization, the PDF path uses the
stored snapshot geometry, identities, labels, ordering, and page metadata.

## Layout Schema

`bubble_sheets.layout_schema_version` is added with legacy default `1`. The
Phase A v2 trigger marks `generator_version = 'phase-a-v2'` rows as schema `2`.
The layout RPC returns finalized sections, questions, options, normalized
rectangles, canonical ordinals, page numbers, and source identities. It does
not return `is_correct` or other answer-key data.

The variable-count generator stores one snapshot option list per question and
uses `choices_count` only as a legacy compatibility maximum. The v2 renderer
uses the per-question option arrays as authority.

## Coordinate System

Geometry is normalized to the A4 page: `x`, `y`, `width`, and `height` are
fractions of page width/height. Server-side coordinate checks enforce bounded
rectangles. The renderer converts normalized values to fixed A4 millimetres;
it does not depend on browser viewport dimensions.

## Variable Option Counts

The variable snapshot RPC accepts eligible non-manual questions with option
counts from the authoritative source, including mixed counts such as MCQ4 and
TF2. Each question retains its own option IDs, labels, canonical order, and
geometry. Questions with no eligible options are blocked before generation.

Manual/non-OMR questions are excluded by the existing server eligibility
rules rather than being silently rendered as answer bubbles.

## Mixed Exam Behavior

Mixed option counts are represented per question in schema v2. The UI derives
the displayed count from the loaded source structure, indicates invalid or
optionless structures, and keeps the question count read-only. The server
revalidates the exact question and option sets before finalization.

## Pagination

Pagination is deterministic from fixed A4 dimensions, margins, row spacing,
section order, and question order. Stored `page_number` and normalized section
and question rectangles are used when reloading a finalized layout.

## Legacy Compatibility

Existing legacy layouts retain schema version `1` and the previous uniform
count behavior. The existing legacy generation branch was not removed. The
new v2 path is selected for current source-authoritative generation and does
not alter the OMR worker/detector or scanning behavior.

## Security

The finalized-layout read RPC requires an authenticated staff role and checks
institution ownership for non-super-admin callers. Snapshot generation is
performed by security-definer RPCs with `search_path = public, pg_temp`; direct
PUBLIC/anonymous execution is revoked. The layout response contains no answer
correctness flags. The frontend does not receive or query answer keys for this
flow.

## Determinism Evidence

- Static tests verify ordered snapshot-to-layout conversion and PDF use of the
  finalized layout.
- Local mixed-source runtime smoke passed with:
  `layout_schema_version=2`, question option counts `[4,2]`, two questions,
  and `answer_key_exposed=false`.
- The Phase A.6 local runtime covered idempotent reuse and source-aware
  regeneration, including immutable snapshot behavior.
- Repeated layout serialization is covered by the Phase B test contract.

## Runtime/Layout Tests

| ID | Check | Result | Evidence |
|---|---|---|---|
| B1 | MCQ4 layout | PASS (static/serialized contract) | Phase B layout test |
| B2 | TF2 layout | PASS (static/serialized contract) | Phase B layout test |
| B3 | Mixed MCQ4 + TF2 | PASS | Local RPC smoke: `[4,2]` |
| B4 | Manual question excluded | PASS (contract) | Eligibility and no-answer-key checks |
| B5 | Other supported option count | PASS (static/serialized contract) | Phase B layout test |
| B6 | Pagination on larger input | PASS (contract) | Deterministic page-count assertions |
| B7 | Repeated serialization | PASS (contract) | Determinism assertion |
| B8 | Snapshot persistence then reload | PASS | Phase B flow test and local RPC path |
| B9 | Finalized snapshot is render authority | PASS | Create → finalized-layout RPC → PDF ordering |
| B10 | Source edit/idempotency compatibility | PASS | Phase A.6 local runtime |
| B11 | Zero eligible questions blocked | PASS (frontend/static) | `NO_OMR_ELIGIBLE_QUESTIONS` path |
| B12 | Legacy renderer compatibility | PASS (static) | Legacy branch retained; no visual run |

## Visual Verification

No browser visual/PDF inspection was executed in this turn. The generated
bundle and static/serialized contracts pass, but physical PDF registration-mark
and detector-coordinate verification remains required before Phase C.

## Phase A Regression

The Phase A and Phase A.6 migration contracts remain present. The Phase B
functions use the existing relational snapshot tables and preserve finalized
immutability and exact source validation. No Phase A migration was edited.

## Files Changed

Phase B-specific files are:

- `supabase/migrations/20260923090000_phase_b_snapshot_layout_rpc.sql`
- `supabase/migrations/20260923091000_phase_b_variable_snapshot_generation.sql`
- `src/lib/bubble-sheet.ts`
- `src/views/BubbleSheet.tsx`
- `security/phase-b-layout-static.test.mjs`
- `security/omr-template-snapshot-static.test.mjs`
- `security/bubble-sheet-option-loading-static.test.mjs`
- `package.json` (security-test registration for the Phase B test)

No Python worker, detector, database deployment, or Cloud operation was
performed.

## Remaining Gaps

1. Browser visual verification of generated PDFs is still outstanding.
2. A physical scan/detector acceptance run against a v2 mixed snapshot is
   still outstanding and belongs before Phase C.
3. The four existing live authorization tests remain skipped because isolated
   staging security fixtures are unavailable.
4. The current worktree contains unrelated pre-existing changes; only the
   Phase B-specific files above should be isolated for review.

## Verdict

NOT READY FOR PHASE C
