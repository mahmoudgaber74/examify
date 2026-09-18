# PHASE B.2 — RUNTIME + PAGE IDENTITY CLOSURE REPORT

## Status

PARTIAL

## Python Runtime

The reproducible environment is the existing `services/omr-service/Dockerfile`
with Python 3.11 and `services/omr-service/requirements.txt`. A local Docker
image was built; no Cloud/VPS deployment was performed.

- OpenCV: 4.10.0
- NumPy: 2.1.3
- pypdfium2: 4.30.0
- qrcode: 8.0
- Pillow: 11.0.0
- Existing OMR pytest suite: 6 passed

OpenCV, NumPy, PDF conversion, QR, and image dependencies are already pinned
in the project requirements. No global package installation was used.

## Existing Detector Runtime Baseline

The current detector was run in the Docker environment against rendered Phase
B PDFs with synthetic marks placed at the actual serialized bubble positions.

| Case | Expected | Actual | Root Cause | Status |
|---|---|---|---|---|
| D1 MCQ4 | Detect selected option | blank / no selection | detector grid uses legacy coordinates | FAIL baseline |
| D2 TF2 | Detect selected option | blank / no selection | detector has one global grid | FAIL baseline |
| D3 MCQ4 + TF2 | Detect both variable rows | blank / no selection | global `choices_count` and legacy geometry | BLOCKED FOR PHASE C |
| D4 MCQ5 | Detect option E | blank / no selection | current worker/detector contract is legacy | FAIL baseline |
| D5 shift | Preserve detection | blank / no selection | baseline geometry mismatch precedes transform tolerance | BLOCKED |
| D6 rotation | Preserve detection | blank / no selection | baseline geometry mismatch precedes transform tolerance | BLOCKED |

These are actual detector results, not padded/fabricated choices.

## QR Browser Verification

- Production QR code path: present in `src/lib/bubble-sheet.ts` using the
  existing `qrcode` library.
- Headless Node rendering with QR: blocked because the library requires a
  Canvas element.
- Browser-capable verification: not completed; the available browser runtime
  could not be initialized in this environment.
- QR decoded payload: NOT RUN.

The intended v2 sanitized payload shape is:

```json
{
  "v": 1,
  "t": "opaque-template-token",
  "s": "snapshot-id",
  "p": 1,
  "n": 2,
  "l": 2
}
```

No answer key or grading data is encoded.

## Multi-page Identity Architecture

Every finalized v2 page now receives its own QR payload containing:

- `s`: finalized snapshot/layout ID;
- `p`: one-based page index;
- `n`: total page count;
- `l`: layout schema version;
- `t`: existing opaque template token;
- `v`: existing template version.

The QR region is explicitly returned as `page_identity_region` in the
finalized layout contract. It is fixed normalized A4 geometry and is rendered
on every v2 page. Legacy layouts retain the existing first-page QR behavior.

## Page Identity Security

The QR contains opaque UUID/token references, not authorization or answer-key
material. The IDs are not treated as authorization: a future worker must use
the decoded identity only to select the stored layout under trusted server
context and existing institution/security checks. No client signing scheme was
invented. If untrusted scanning endpoints are introduced later, the server
should add a signed/short-lived page token before accepting external identity
claims.

## Serialized Layout Changes

The v2 layout now includes:

```text
page_identity_region: {
  x: normalized number,
  y: normalized number,
  width: normalized number,
  height: normalized number
}
```

The new forward migration is:
`supabase/migrations/20260923092000_phase_b_page_identity.sql`.
It updates the finalized-layout RPC only, preserves its staff/institution
authorization, and returns `NULL` for legacy/non-QR layouts.

## Shuffled Page Runtime Test

Not run because QR decoding was blocked. The serialized contract now carries
all fields required for this test, but no claim of runtime shuffle success is
made.

| Page | Decoded Identity | Correct Layout Selected | Status |
|---|---|---|---|
| 1 | Not decoded | Not run | BLOCKED |
| 2 | Not decoded | Not run | BLOCKED |

## Detector Handoff Test

The intended future handoff is:

```text
scanned page
→ decode QR {s,p,n,l}
→ authorized finalized-layout lookup by s
→ select questions/options where page_number = p
→ pass stored per-question/per-option geometry to detector
```

The identity fields and layout lookup contract are implemented, but the
detector was intentionally not refactored in Phase B.2.

## Phase C Input Contract

```text
PageProcessingContext {
  layout_schema_version: number,
  snapshot_id: uuid,
  exam_id: uuid,
  page_index: number,
  page_count: number,
  page_width_mm: number,
  page_height_mm: number,
  questions: [
    {
      snapshot_question_id: uuid,
      page_number: number,
      global_question_number: number,
      rect: { x, y, width, height },
      options: [
        {
          snapshot_option_id: uuid,
          option_id: uuid,
          canonical_option_ordinal: number,
          visual_index: number,
          rect: { x, y, width, height }
        }
      ]
    }
  ]
}
```

Phase C must not derive v2 sampling from global `choices_count`.

## Regression

- Phase B focused/static tests: 17 PASS / 0 FAIL.
- OMR Docker pytest: 6 PASS / 0 FAIL.
- Local B.2 migration application: PASS (`CREATE FUNCTION`, `REVOKE`,
  `GRANT`).
- Phase B.1 PDF fixtures: generated and visually inspected; representative
  mixed and multi-page pages pass.
- QR rendering/decoding: BLOCKED.
- Shuffled multi-page identity: NOT RUN.
- Current detector baseline: executed; failures recorded above.
- `npm run typecheck`: PASS.
- `npm run lint`: 0 errors / 30 existing warnings.
- `npm run build`: PASS.
- `npm run test:security`: 97 PASS / 0 FAIL / 4 SKIP.
- Phase A/Phase A.6 static and local regression assertions: PASS in the
  security suite and prior local runtime evidence.

## Remaining Gaps

### FAIL

- Current detector cannot process the v2 variable geometry contract; this is
  the expected Phase C implementation boundary, not a layout workaround.

### BLOCKED

- Browser Canvas QR render/decode verification.
- Independent shuffled-page runtime association.
- Host-side marked-sheet detector transformations until the browser/QR and
  detector environment is available for the complete acceptance harness.

### NOT RUN

- Full Phase C snapshot-ID detector mapping.
- Physical scan acceptance.

### SKIPPED

- Four existing live authorization tests due unavailable isolated staging
  fixtures.

## Verdict

NOT READY FOR PHASE C
