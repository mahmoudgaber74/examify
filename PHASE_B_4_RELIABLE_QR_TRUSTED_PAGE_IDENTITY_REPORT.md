# PHASE B.4 — RELIABLE QR + TRUSTED PAGE IDENTITY REPORT

## Status

PARTIAL

## QR Failure Root Cause

The B.3 300-DPI rendered pages use a 25 mm QR region, but OpenCV measured a
decoded/located quadrilateral of about 291×292 px on page 1, about 150×151 px
on page 2, about 284×283 px on page 3, and no quadrilateral on page 4. Pages
2 and 4 therefore have a raster/decoder failure, not an application-state
decode. The original long JSON payload was also replaced in this phase with a
compact token payload; a new complete pixel-decode run is still required.

## Final QR Contract

For v2 pages the printed payload is:

`v2:<opaque-page-token-uuid>`

Legacy pages retain the existing JSON contract with `v` and `t`. No geometry,
answer key, grading data, or provider secret is embedded.

## Authoritative Page Identity

QR token
→ `bubble_sheet_pages.page_token`
→ `bubble_sheet_pages.bubble_sheet_id`
→ finalized `bubble_sheets` snapshot/sheet
→ authoritative page index, page count, institution, and layout version.

`resolve_v2_page_identity(uuid)` is service-role-only, uses a fixed
`search_path`, rejects unknown/non-finalized/version-mismatched rows, and
returns sanitized page metadata. `validate_v2_page_set(uuid[])` rejects
empty, duplicate, unknown, mixed-sheet, incomplete, and non-contiguous sets.

## QR Reliability

| DPI | Pages Tested | Pages Decoded | Status |
|---|---:|---:|---|
| 300 | 4 | 2 | PARTIAL |
| 200 | 0 | 0 | NOT RUN |
| 150 | 5 | 0 in B.3 OpenCV run | NOT ACCEPTED |

## Shuffled Page Runtime

NOT RUN. A complete five-page pixel decode and an authenticated authoritative
page-resolution runtime are still required.

## Page Set Validation

- Duplicate: validator returns `omr_page_set_duplicate`.
- Missing: validator returns `omr_page_set_incomplete`.
- Incomplete expected page count: validator returns `omr_page_set_incomplete`.
- Complete set: validator returns `{ valid: true }` when all authoritative
  pages of one sheet are supplied.

The validator uses server-stored page metadata, not client-supplied count.
Runtime database execution is not yet performed.

## Cross-Sheet / Cross-Version Tests

The validator rejects mixed sheets with `omr_page_set_mixed_sheet`. The page
metadata includes the authoritative layout schema version, so mixed-version
sets are rejected by the same coherent-set check once runtime-executed.
No live runtime execution was performed.

## Tamper Tests

| Attack | Result | Status |
|---|---|---|
| unknown token | resolver rejects `omr_page_identity_not_found` | STATIC PASS |
| malformed token | QR reader rejects invalid v2 token | STATIC PASS |
| token from another sheet | worker rejects `omr_v2_page_identity_sheet_mismatch` | STATIC PASS |
| unsupported version | v2 is blocked before legacy bubble detection | STATIC PASS |
| legacy QR on v2 path | no v2 token is accepted as v2 | STATIC PASS |
| v2 QR on legacy detector | layout guard rejects before detection | STATIC PASS |

## V2 Processing Handoff

Raster Page
→ QR
→ Opaque Token
→ Server Resolution
→ V2 Page Layout
→ Detector Boundary

The worker now resolves a decoded v2 token and verifies it belongs to the job's
sheet before the result is allowed to complete. The detector receives no v2
bubble classification yet; Phase C remains out of scope.

## V2 Fail-Closed

Legacy detector cannot process v2 accidentally: YES.

The worker passes `layout_schema_version`, the service recognizes compact v2
tokens, and v2 requests stop before `detect_bubbles`. Legacy version 1 keeps
the existing path.

## Legacy Compatibility

Legacy QR JSON and legacy global `choices_count` behavior remain unchanged.
The new page table is opt-in for finalized page identities and has no public,
anonymous, or authenticated direct table grants.

## Regression

- layout/static tests: 6 PASS.
- browser PDF generation: PASS for existing one-page and four-page fixtures.
- OMR pytest: 6 PASS, 1 warning.
- typecheck: PASS.
- build: PASS.
- security suite: 97 PASS, 0 FAIL, 4 SKIP.
- lint: 0 errors, 30 warnings.
- complete B.4 QR/shuffle runtime: NOT RUN.

## Remaining Gaps

### FAIL

- None in the existing legacy OMR pytest/static regression checks.

### BLOCKED

- Complete QR pixel acceptance for every page at 300/200/150 DPI.
- Runtime execution of the new migration/RPCs against a local transaction.
- Five-page browser fixture generated from an actual finalized snapshot RPC.
- Shuffled-page, duplicate/missing, cross-sheet, and tamper runtime proof.
- Authoritative multi-page worker processing beyond the detector boundary.

### NOT RUN

- Cloud execution, deployment, db push, provider delivery, and Phase C
  variable bubble detection.

### SKIPPED

- Four existing live security tests because isolated staging fixtures were
  unavailable.

## Verdict

NOT READY FOR PHASE C
