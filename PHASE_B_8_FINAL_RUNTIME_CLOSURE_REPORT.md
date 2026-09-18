# PHASE B.8 — FINAL RUNTIME CLOSURE REPORT

## Status

PARTIAL

The page-index invariant and the server-side v2 page-context contract passed
local rollback/static verification. Step 2 now wires the trusted page context
through the worker and FastAPI boundary. Full queued-worker acceptance remains
blocked because the v2 detector is intentionally not implemented and no real
uploaded queued v2 job was executed.

## Cross-Snapshot Runtime

| Input | Result | Status |
|---|---|---|
| A1 page 1 + A2 page 2 | `omr_page_set_mixed_sheet` | PASS |
| Complete A1 page set (pages 1–5) | `valid=true`, `page_count=5` | PASS |

The current schema represents the authoritative snapshot identity with the
finalized bubble-sheet identity (`snapshot_id` in the layout contract is the
sheet id). Consequently, the mixed A1/A2 rejection is expressed as a mixed-sheet
rejection rather than a separate snapshot error.

## Cross-Institution Runtime

| Input | Result | Metadata Leak | Status |
|---|---|---|---|
| Institution A A1 page + Institution B B1 page | `omr_page_set_mixed_sheet` | None | PASS |

The validator returned only the rejection and no layout or institution metadata.

## Authorization

The trusted caller model remains service-role only for
`resolve_v2_page_identity(uuid)` and `validate_v2_page_set(uuid[])`. `anon` and
`authenticated` have no EXECUTE privilege. No client grant was added.

## Queued Worker Flow

Step 2 correction: the worker now calls the trusted page-context RPC and
validates `V2PageProcessingContext` before passing it to FastAPI. Any earlier
wording in this section describing the handoff as unwired is superseded by
this Step 2 result.

The production path is:

Upload/Job (`omr-analyze` → `enqueue_omr_processing_job`)
→ `claim_next_omr_processing_jobs`
→ `services/omr-service/app/worker.py:process`
→ `/v1/omr/analyze` and `qr_reader.read_qr`
→ opaque `v2:<page_token>`
→ `resolve_v2_page_identity`
→ (new trusted context RPC available, not yet wired into worker)
→ detector boundary (`unsupported_v2_layout`)

`get_v2_finalized_bubble_sheet_layout` is used by the frontend generation path,
but is not called by the worker. Step 1 now adds
`get_v2_finalized_page_processing_context(uuid, uuid)` for the trusted worker;
the worker now calls this RPC and validates the typed context before forwarding
it to FastAPI.

## Queued Worker Runtime

| Step | Expected | Actual | Status |
|---|---|---|---|
| receive queued job | worker claims a job | production claim functions identified | BLOCKED |
| read actual image | A1 raster/PDF | no complete queued fixture available | BLOCKED |
| QR pixel decode | opaque v2 token | standalone OMR QR suite already passed | PASS (prior B7) |
| token resolution | authoritative page | resolver path identified; service-role-only | PASS (prior B6/B7) |
| exact serialized layout load | v2 geometry | trusted context RPC called by worker | PASS |
| v2 processing context | server-derived geometry context | typed context constructed and passed to FastAPI | PASS |
| detector boundary | fail closed | `main.py` returns `unsupported_v2_layout` for v2 | PASS (static/runtime code path) |

## Context Mismatch Tests

- Job snapshot versus QR: the job schema carries `template_id`, not a separate
  snapshot id. The worker rejects a resolved token when its authoritative
  `bubble_sheet_id` differs from `template_id`; no job field overrides the QR.
- Job page versus QR: the current job schema carries no page index. There is no
  page claim available to override the authoritative token; page identity is
  resolved from the QR token.
- Cross-institution job: a job bound to A with a B token fails the authoritative
  sheet-id comparison before any v2 detector processing.

## Database Constraint Runtime

| Case | Constraint | Result | Status |
|---|---|---|---|
| duplicate opaque token | `bubble_sheet_pages_page_token_key` | database unique-violation | PASS |
| duplicate sheet/page index | `bubble_sheet_pages_bubble_sheet_id_page_index_key` | database unique-violation | PASS |
| `page_index = 0` | `bubble_sheet_pages_page_index_check` | check-violation | PASS |
| negative page index | `bubble_sheet_pages_page_index_check` | check-violation | PASS |
| `page_index > page_count` | `bubble_sheet_pages_page_index_within_count_check` | check-violation in migration rollback test | PASS |

All constraint attempts were inside a transaction and rolled back. The new
forward migration enforces both `page_index >= 1` and `page_index <= page_count`
on the same persisted page row.

## Final V2 Processing Context

The Step 1 RPC returns the following sanitized authoritative structure for A1
page 1 (actual local runtime call):

```text
{
  sheet_id,
  page_id,
  page_index,
  page_count,
  institution_id,
  exam_id,
  layout_schema_version,
  orientation,
  questions: [{
    snapshot_question_id,
    exam_question_id,
    question_id,
    question_type,
    points_snapshot,
    global_question_number,
    page_number,
    region: { x, y, width, height },
    options: [{
      snapshot_option_id,
      source_option_id,
      label,
      visual_index,
      canonical_option_ordinal,
      region: { x, y, width, height }
    }]
  }]
}
```

Page dimensions are not persisted in the snapshot schema; orientation and the
existing A4 convention remain available separately. The typed Python models
represent the returned context but are not yet used by the worker.

## Sensitive Data Check

`is_correct` present? **NO**

Answer key present? **NO**

The resolver/page-set APIs return identity metadata only. The frontend v2 layout
contract contains geometry identifiers and coordinates, not answer correctness.

## Legacy / V2 Routing

Can v2 queued processing reach global `choices_count` detector? **NO**

Legacy preserved? **YES**

The v2 branch in `services/omr-service/app/main.py` emits
`unsupported_v2_layout` and skips `detect_bubbles`; legacy templates retain the
existing detector path.

## Regression

- Page-index runtime rollback harness: 9/9 invariant and uniqueness assertions
  PASS.
- Phase B + B8 Step 1 static: 8/8 PASS.
- Phase B static: 6/6 PASS.
- QR/shuffled page acceptance: prior B7 runtime 5/5 QR and 5/5 DB resolution PASS.
- Page-set: complete same-sheet, mixed-sheet, duplicate, missing, and prior
  cross-sheet checks PASS; cross-snapshot is represented by mixed-sheet identity.
- Worker context pytest: 8 passed, 3 warnings.
- Focused Phase B/B8 static tests: 10 PASS, 0 FAIL.
- Security: 102 PASS, 0 FAIL, 4 SKIP.
- Typecheck: PASS.
- Lint: 0 errors, 30 warnings.
- Build: PASS.

## Remaining Gaps

### FAIL

- None in the page-index invariant tests.

### BLOCKED

- Full real queued v2 job with uploaded A1 raster through the worker entry path.
- Full real queued v2 job with uploaded A1 raster through the worker entry path.
- Job/page mismatch runtime with a page-index claim (the current schema has no
  such claim).

### NOT RUN

- Cloud deployment, Cloud database, provider delivery, and Phase C detector.

### SKIPPED

- Four existing live security tests because isolated staging fixtures are
  unavailable.

## Verdict

NOT READY FOR PHASE C

Do not deploy. Do not implement Phase C detector work until the queued worker
handoff and the page-index validity gap are resolved or explicitly accepted.

## Step 2 Trusted Context Wiring

- Worker order is QR decode -> authoritative page identity resolution -> job,
  scan, sheet, exam, institution, and page metadata checks -> trusted context
  RPC -> typed `V2PageProcessingContext` validation -> FastAPI.
- The worker rejects sheet, exam, institution, page, and question-page
  mismatches before the detector boundary.
- FastAPI requires a v2 context for layout schema 2, validates page bounds,
  rejects v2 requests without context, and keeps legacy requests unchanged.
- Variable option counts are serialized per question in the typed context; no
  global `choices_count` is introduced for v2.
- Step 2 static tests: 2 PASS; worker context tests: 8 PASS.
- The context contract contains no `is_correct`, answer key, score, or grading
  field.
- No deployment, `db push`, Phase C work, or v2 detector implementation was
  performed.
