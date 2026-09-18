# PHASE B.3 — QR + SHUFFLED PAGE ACCEPTANCE REPORT

## Status

PARTIAL

## Browser Runtime

Playwright 1.62.1 with Chromium headless was available locally. The actual
browser-bundled `generateBubbleSheetPDF` renderer was executed and produced
PDF files. The in-app Browser skill was unavailable in this environment, so
the authenticated BubbleSheet route and Cloud snapshot RPC were not used.
The fixtures were deterministic finalized-layout-shaped v2 fixtures; they
were not created by a live snapshot RPC.

## Actual PDF Fixtures

- `tmp/pdfs/phase-b-3/single-mixed.pdf`: 1 page, MCQ4 + TF2 layout.
- `tmp/pdfs/phase-b-3/multi-page.pdf`: 4 pages, 65-question v2 layout.
- Pages were rasterized with PyMuPDF at 150 DPI and 300 DPI.

## QR Pixel Decode

| Page | Expected Identity | Decoded Identity | Status |
|---|---|---|---|
| single p1 | v2, snapshot, page 1/1 | not decoded by OpenCV detector | BLOCKED |
| multi p1 | v2, snapshot, page 1/4 | v2 keys `v,t,s,p,n,l`; page 1/4; snapshot sanitized | PASS |
| multi p2 | v2, snapshot, page 2/4 | QR detected but payload not decoded | BLOCKED |
| multi p3 | v2, snapshot, page 3/4 | v2 keys `v,t,s,p,n,l`; page 3/4; snapshot sanitized | PASS |
| multi p4 | v2, snapshot, page 4/4 | not decoded by OpenCV detector | BLOCKED |

The decoded payload values were not printed except for page/count/layout
metadata and a sanitized snapshot prefix. No secret values were exposed.

## Scan Resolution Test

150 DPI and 300 DPI rasterizations were tested. At 300 DPI, pages 1 and 3
decoded successfully; pages 2 and 4 were detected or visible but did not
yield decoded payload text. A lower-resolution acceptance result cannot be
claimed because the normal-resolution decode matrix is incomplete.

## Shuffled Page Test

NOT RUN. Pixel decoding was not complete for every page, and the current
processing boundary has no authoritative v2 page-set resolver to execute.

## Page Set Validation

- Duplicate page `1,2,2,3`: NOT RUN at a production processing boundary.
- Missing page `1,3`: NOT RUN at a production processing boundary.
- Inconsistent page count: NOT RUN at a production processing boundary.
- Cross-sheet mixing: NOT RUN at a production processing boundary.

The current OMR worker submits one legacy template context per job and has no
implemented server-side page-set validation for decoded v2 metadata.

## QR Trust Boundary

The QR fields `s`, `p`, `n`, and `l` are scanned input and therefore
untrusted. The current worker/HTTP detector path does not yet fetch and verify
those fields against authoritative snapshot/page rows; it only uses the
legacy `t` token comparison after detection. Consequently, v2 page identity
validation is not yet a trusted processing boundary and must be implemented
before Phase C.

## Tamper Runtime Tests

| Attack | Expected | Actual | Status |
|---|---|---|---|
| valid sheet + impossible page index | reject | no v2 server validator exercised | BLOCKED |
| incorrect page count | reject or authoritative value | no v2 server validator exercised | BLOCKED |
| snapshot A identity in snapshot B context | reject | no v2 server validator exercised | BLOCKED |
| unsupported layout version | reject | detector guard rejects v2 before legacy detection; no QR tamper path | PARTIAL |

## Detector Handoff

Raster Page
→ QR Decode
→ Server Validation
→ Page Layout
→ Detector Context

The renderer and QR contract are present. The current worker does not yet
construct the v2 per-page detector context, so the authoritative handoff is
BLOCKED. The narrow version guard now prevents a v2 template from silently
entering the legacy global-`choices_count` detector when the worker passes
`layout_schema_version >= 2`.

## V2 Fail-Closed Behavior

NO — v2 must not accidentally enter legacy global `choices_count` detection.

`TemplateMetadata.layout_schema_version` defaults to legacy `1`; the worker
passes the database layout version; `main.py` rejects version 2 or newer with
`unsupported_v2_layout` before bubble detection. Legacy templates retain the
existing detector path.

## Legacy Compatibility

Legacy templates continue to use the existing `template_version`, global
`choices_count`, and legacy QR behavior. The guard is opt-in through the
stored layout schema version and does not alter legacy rows.

## Regression

- Phase B static/layout tests: 18 PASS.
- Browser PDF generation: PASS for both deterministic fixtures.
- QR pixel decode: PARTIAL; 2 of 5 rendered pages decoded at 300 DPI.
- Shuffled-page tests: NOT RUN.
- OMR pytest: 6 PASS, 1 warning.
- Typecheck: PASS.
- Lint: 0 errors, 30 pre-existing warnings.
- Build: PASS; existing bundle-size, Browserslist, and Mammoth warnings remain.
- Security suite: 97 PASS, 0 FAIL, 4 SKIP (staging fixtures unavailable).

## Remaining Gaps

### FAIL

- None observed in the existing legacy OMR regression suite.

### BLOCKED

- Complete QR pixel decode for every page.
- Authenticated route generation from an actual finalized local/Cloud snapshot.
- Authoritative v2 QR identity validation and page-set validation.
- Shuffled-page, duplicate/missing-page, cross-sheet, and tamper runtime tests.
- v2 detector context handoff; the detector itself remains legacy-only by design.

### NOT RUN

- Cloud execution, deployment, database migration, provider delivery, and
  Phase C detector implementation.

### SKIPPED

- Four existing live security tests because isolated staging security
  fixtures were unavailable.

## Verdict

NOT READY FOR PHASE C
