# PHASE B.7 — ACCEPTANCE FIXTURE CLOSURE REPORT

## Status

PARTIAL

## Local Fixtures

Institutions
→ Exams
→ Snapshots
→ Sheets
→ Pages

- Institution A: local deterministic institution.
- Exam A: `B7 Exam A`.
- Snapshot/Sheet A1: 10 serialized questions, 5 pages.
- Snapshot/Sheet A2: 4 serialized questions, 2 pages.
- Institution B / Exam B / Sheet B1: 4 serialized questions, 2 pages.
- All three sheets are finalized v2 fixtures with no answer-key fields in
  page-processing data.

## Five-Page Snapshot

- Serialized page count: 5.
- Browser PDF page count: 5.
- `bubble_sheet_pages` rows: exactly 5 for A1.
- Page tokens: unique; each page has a distinct token.

## QR + Resolution

| Page | Pixel Decode | DB Resolve | Authoritative Page | Status |
|---:|---|---|---:|---|
| 1 | PASS | PASS | 1/5 | PASS |
| 2 | PASS | PASS | 2/5 | PASS |
| 3 | PASS | PASS | 3/5 | PASS |
| 4 | PASS | PASS | 4/5 | PASS |
| 5 | PASS | PASS | 5/5 | PASS |

The PDF was generated through the browser renderer using the actual A1 page
tokens. QR decoding used the rasterized pixels at 300 DPI.

## Shuffled Runtime

| Input Position | Physical Page | DB Page | Layout Page | Status |
|---:|---:|---:|---:|---|
| 1 | 4 | 4/5 | 4 | PASS |
| 2 | 1 | 1/5 | 1 | PASS |
| 3 | 5 | 5/5 | 5 | PASS |
| 4 | 2 | 2/5 | 2 | PASS |
| 5 | 3 | 3/5 | 3 | PASS |

File order was not used for page identity.

## Page Set Validation

| Case | Expected | Actual | Status |
|---|---|---|---|
| complete canonical | valid | `valid=true`, page_count 5 | PASS |
| complete shuffled | valid | `valid=true`, page_count 5 | PASS |
| duplicate | reject | `omr_page_set_duplicate` | PASS |
| missing | reject/incomplete | `omr_page_set_incomplete` | PASS |
| partial | reject/incomplete | implemented; not separately executed | BLOCKED |
| cross-sheet | reject | `omr_page_set_mixed_sheet` | PASS |
| cross-snapshot | reject | sheet identity mismatch contract | BLOCKED |
| cross-institution | reject | mixed-sheet rejection; no separate B1 run | BLOCKED |

## Cross-Boundary Runtime

Cross-sheet A1+A2 and cross-institution A1+B1 are represented by distinct
fixtures and the validator's authoritative sheet check. The cross-sheet
runtime rejection was executed. Separate cross-institution and
cross-snapshot calls remain pending because the current acceptance command
did not run those two arrays.

## Authorization Matrix

| Caller | Own Institution | Other Institution | Status |
|---|---|---|---|
| anon | EXECUTE denied | EXECUTE denied | PASS (catalog) |
| authenticated | EXECUTE denied | EXECUTE denied | PASS (catalog) |
| service_role worker | EXECUTE granted | resolver requires valid token/sheet | PASS (catalog/static) |

No broad client grant was added. The worker is the intended caller.

## Exact Layout Selection

Sanitized representative page structure:

```text
{
  snapshot_id,
  page_index: 4,
  page_count: 5,
  questions: [
    { snapshot_question_id, rect, options: [
      { snapshot_option_id, canonical_option_ordinal, rect }
    ] }
  ]
}
```

The browser PDF used the same authoritative A1 page tokens. The existing
database layout RPC remains responsible for serialized questions/options;
the v2 detector still intentionally stops before bubble classification.

## V2 Processing Context

```text
{
  sheet_id,
  snapshot_id,
  institution_id,
  layout_schema_version,
  page_index,
  page_count,
  page_width,
  page_height,
  questions: [{ snapshot_question_id, region, options: [{ snapshot_option_id, ordinal, geometry }] }]
}
```

No `is_correct`, answer key, score, or grading fields are present.

## Detector Boundary Handoff

Raster
→ QR
→ Token
→ DB
→ Exact Layout
→ V2 Context
→ unsupported_v2_layout

Identity resolution and v2 fail-closed routing are proven. Full worker
end-to-end handoff was not executed with an actual queued scan job.

## Legacy / V2 Routing

Can v2 execute legacy global `choices_count` detection? **NO**.

## Database Constraints

- Unique opaque page token: defined and catalog-verified.
- Unique sheet/page index: defined and catalog-verified.
- Invalid page index is rejected by the table check (`page_index >= 1`).
- Duplicate insert runtime attempts were not separately executed.

## Regression

- Phase B static: 6/6 PASS.
- QR: 5/5 at 300 DPI for A1.
- Shuffled pages: 5/5 correct DB page resolution.
- Page-set runtime: complete, shuffled, duplicate, missing, and cross-sheet
  assertions executed successfully.
- OMR pytest: 6 PASS, 1 warning.
- Authorization/security: 97 PASS, 0 FAIL, 4 SKIP.
- Typecheck: PASS.
- Lint: 0 errors, 30 warnings.
- Build: PASS.

## Remaining Gaps

### FAIL

- None observed in executed assertions.

### BLOCKED

- Separate runtime calls for partial, cross-snapshot, and cross-institution
  arrays.
- Queued worker handoff through an actual scan job.
- Duplicate database insert runtime assertions.

### NOT RUN

- Cloud deployment, Cloud database, provider delivery, and Phase C detector.

### SKIPPED

- Four live security tests due unavailable isolated staging fixtures.

## Verdict

NOT READY FOR PHASE C
