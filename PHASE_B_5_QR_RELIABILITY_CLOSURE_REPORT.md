# PHASE B.5 — QR RELIABILITY CLOSURE REPORT

## Status

PARTIAL

## Root Cause

B.4's failed pages did not contain a QR. Measurement of the old four-page
PDF showed that only page 1 had a QR because `buildBubbleSheetLayout()` did
not preserve `layoutSchemaVersion` and `snapshotId`; therefore the renderer's
v2 condition was false and it intentionally drew a QR only on page 1.

## QR Rendering Pipeline

QR Data
→ QR library
→ browser PDF renderer
→ PDF
→ raster
→ OpenCV QRCodeDetector

The failure occurred between layout metadata and PDF page rendering. The
renderer now preserves v2 identity and uses the server-provided opaque page
token for every page.

## Final QR Print Specification

- Physical region: 25 mm × 25 mm.
- Quiet zone: QR library margin 1; fixed white page area around the region.
- Error correction: library default M; no change was required after the root
  cause was fixed.
- Rendering format: high-resolution PNG generated in the browser and embedded
  in the PDF.
- Minimum supported scan DPI: 150 DPI in the tested local raster pipeline.
- Contrast: black modules on white background.

## QR Measurements

| Page | DPI | px/module | Decode | Status |
|---|---:|---:|---|---|
| 1–5 | 300 | approximately 9–10 | 5/5 | PASS |
| 1–5 | 250 | approximately 7–8 | 5/5 | PASS |
| 1–5 | 200 | approximately 6 | 5/5 | PASS |
| 1–5 | 150 | approximately 4–5 | 5/5 | PASS |

Each page used a distinct deterministic page token. The decoded payload length
was 39 characters (`v2:` plus UUID); no secret values were reported.

## QR Acceptance

| DPI | Pages | Decoded | Status |
|---:|---:|---:|---|
| 300 | 5 | 5 | PASS |
| 250 | 5 | 5 | PASS |
| 200 | 5 | 5 | PASS |
| 150 | 5 | 5 | PASS |

## Rotation / Scale Test

On page 3 at 300 DPI, OpenCV decoded successfully after rotation of -2° and
+2°, and after scale changes of 95% and 105%.

## Shuffled Page Runtime

The renderer and token contract support file-order-independent resolution, but
the authenticated database resolver was not executed against a persisted
five-page fixture in this run.

| Input Position | Token | Authoritative Page | Layout Selected | Status |
|---:|---|---:|---|---|
| 1–5 shuffled | distinct v2 token | requires resolver runtime | requires resolver runtime | BLOCKED |

## Page Set Runtime

- Complete: validator implemented; runtime DB call not completed.
- Duplicate: `omr_page_set_duplicate` implemented; runtime DB call not completed.
- Missing: `omr_page_set_incomplete` implemented; runtime DB call not completed.
- Cross-sheet: `omr_page_set_mixed_sheet` implemented; runtime DB call not completed.
- Cross-snapshot: authoritative sheet membership/version validation is present;
  runtime DB call not completed.

## Cross-Sheet / Cross-Version Tests

Static contracts reject mixed sheets and prevent v2 from entering the legacy
detector. Full runtime execution remains pending.

## Tamper Runtime

| Case | Actual Result | Status |
|---|---|---|
| random token | resolver rejects unknown token | STATIC PASS |
| token from another sheet | worker rejects sheet mismatch | STATIC PASS |
| token from another snapshot version | resolver rejects version mismatch | STATIC PASS |
| malformed `v2:` | QR reader rejects invalid UUID | STATIC PASS |
| unsupported prefix/version | not accepted as v2 | STATIC PASS |
| legacy QR | remains legacy-only | STATIC PASS |
| v2 QR to legacy detector | blocked by layout schema guard | PASS |

## Trusted V2 Handoff

Raster
→ QR
→ Token
→ Server Resolution
→ Page Validation
→ Exact Layout
→ V2 Detector Context

The current implementation reaches the resolution/validation boundary and
stops before variable bubble detection. No answer key or grading data is part
of the page identity contract.

## V2 Fail-Closed

Can v2 accidentally enter the legacy detector? **NO**.

## Legacy Compatibility

Legacy QR JSON and legacy global-choice detector behavior remain unchanged.
Direct public/anonymous/authenticated table access to page identities remains
revoked; internal resolver execution is limited to `service_role`.

## Regression

- Layout/page identity static tests: 6/6 PASS.
- Browser PDF generation: 5-page PDF PASS.
- QR DPI matrix: 20/20 page-resolution checks PASS.
- Rotation/scale sanity: 4/4 PASS.
- OMR pytest: 6 PASS, 1 warning.
- Typecheck: PASS.
- Build: PASS.
- Security: 97 PASS, 0 FAIL, 4 SKIP.
- Lint: 0 errors, 30 warnings.
- Migration transaction syntax check: PASS, rolled back locally.

## Remaining Gaps

### FAIL

- None in the tested legacy detector regression.

### BLOCKED

- Authenticated runtime execution of `resolve_v2_page_identity()` and
  `validate_v2_page_set()` against persisted five-page fixtures.
- Full shuffled-page, duplicate/missing, cross-sheet, and tamper runtime
  proof through the deployed processing boundary.
- Phase C v2 geometry detector remains intentionally unimplemented.

### NOT RUN

- Cloud migration, deployment, provider delivery, and production runtime.

### SKIPPED

- Four live security tests because isolated staging security fixtures were
  unavailable.

## Verdict

NOT READY FOR PHASE C
