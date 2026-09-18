# PHASE B.1 — VISUAL PDF + DETECTOR DRY-RUN REPORT

## Status

PARTIAL

## Generated PDF Fixtures

Generated locally under `tmp/pdfs/phase-b-1/` using the actual
`buildBubbleSheetLayout()` and `generateBubbleSheetPDF()` functions:

- `A-mcq4.pdf` — two MCQ4 questions.
- `B-mcq4-tf2.pdf` — MCQ4 plus TF2.
- `C-mcq-essay-tf.pdf` — mixed source representation with the essay omitted
  from the OMR-eligible layout.
- `D-mcq5.pdf` — one MCQ5 question.
- `E-multipage.pdf` — 45 MCQ4 questions over two pages.
- `F-v1-first.pdf` and `G-v1-after-source-edit.pdf` — V1 render pair.
- `H-v2-after-source-edit.pdf` — changed-source V2 render.

The fixtures use no production data and no answer key in the layout/PDF
payload. QR was disabled in the headless fixture generator because the
installed QR library requires a browser Canvas; the production code path still
contains the existing QR rendering call.

## Visual Verification

Pages were rendered with PyMuPDF at 1.5x and visually inspected for the
representative mixed and multi-page cases. All generated pages were A4
portrait with registration marks, margins, labels, bubbles, and footer page
identity visible. No clipping or page overflow was observed in inspected pages.

| Fixture | Bubble Counts | Labels | Pagination | QR | Status |
|---|---:|---|---|---|---|
| A-mcq4 | 4, 4 | A-D / A-D | 1 page | Not run headless | PASS |
| B-mcq4-tf2 | 4, 2 | A-D / A-B | 1 page | Not run headless | PASS |
| C-mcq-essay-tf | 4, 2 | A-D / A-B | 1 page | Not run headless | PASS; essay absent |
| D-mcq5 | 5 | A-E | 1 page | Not run headless | PASS |
| E-multipage | 4 × 45 | A-D | 2 pages | Not run headless | PASS |
| F/G V1 pair | 4, 4 | unchanged | 1 page | Not run headless | PASS (geometry) |
| H V2 | 4, 4 | changed source label represented | 1 page | Not run headless | PASS (geometry) |

The B fixture specifically shows four bubbles on row 1 and two bubbles on
row 2.

## Coordinate Verification

- Coordinate origin: top-left of the PDF page.
- Serialized unit: normalized fraction of the fixed A4 page.
- PDF unit: millimetres passed to jsPDF; jsPDF writes physical PDF points.
- Conversion: `pdf_x = normalized_x * 210mm` and
  `pdf_y = normalized_y * 297mm`; the renderer adds the bubble radius in mm
  when converting a bubble rectangle to its center.
- PDF point conversion: `1mm = 72/25.4 points`.
- Rounding: jsPDF/PDF stream numeric serialization; measured tolerance was
  within one serialized PDF point for inspected bubble rectangles.

For B, the first serialized option rectangle starts at normalized
`x=0.1104761905`, `y=0.2313131313`; the extracted PDF drawing rectangle was
`x=65.76pt`, `y=194.74pt`, `15.87pt × 15.87pt`, matching the normalized
conversion within the stated tolerance. The second row likewise preserved the
two-option geometry.

## Determinism

- Layout JSON is deterministic for identical input and ordering; covered by
  Phase B tests.
- Page count and page geometry are deterministic.
- PDF page count is deterministic (`E-multipage` = 2 pages).
- PDF byte identity is not required because PDF metadata/serialization may
  vary; no byte-hash gate was used.
- A full rendered visual hash comparison was not used; the same-layout V1
  pair has matching extracted geometry.

## V1 / V2 Visual Evidence

V1 is rendered from finalized snapshot data and is not reloaded from mutable
source rows. The V1 pair preserves the same geometry and labels. V2 is a new
finalized representation and carries the changed source label in its stored
layout input. The Phase A.6 runtime already verified source-aware idempotency
and immutable V1/V2 semantics.

## Multi-page Identity

Each generated page has registration marks and a footer containing the exam
identifier and page index (`Page 1/2`, `Page 2/2`). The current PDF renderer
invokes QR drawing from the common header path, but QR was not executable in
the headless Node generator because Canvas is unavailable. The footer does
not contain the snapshot ID or a cryptographic page token. Consequently, a
page-2-only scan cannot yet be independently associated with a snapshot using
only the current printed identity. This is a Phase C blocker unless the
scanner workflow supplies a trusted page-order/sheet association.

## Existing Detector Audit

The current detector is in
`services/omr-service/app/processing/bubble_detector.py` and is called by
`services/omr-service/app/main.py`.

Current assumptions:

- `TemplateMetadata` contains one global `choices_count`.
- `build_grid()` derives one global horizontal choice step and one grid from
  `questions_count`, `choices_count`, and columns.
- Results are keyed by sequential `question_number` and option labels
  `A`-`H`.
- The worker currently reads legacy `questions_count`/`choices_count` from
  `bubble_sheets` and sends `template_version: 1`.
- The detector does not consume `snapshot_id`, `layout_schema_version`,
  `snapshot_question_id`, `snapshot_option_id`, stored page numbers, or
  normalized per-option geometry.

Therefore the existing detector is incompatible with variable per-question
option counts and finalized snapshot identity. It must adapt to the Phase B
layout contract in Phase C; no padding or fake global count was introduced.

## Detector Dry-Run Results

| Case | Expected | Actual | Status |
|---|---|---|---|
| B10 MCQ4 detector | Detect from snapshot geometry | Not run: host Python lacks `cv2` | BLOCKED |
| B11 TF2 detector | Detect from snapshot geometry | Not run: host Python lacks `cv2` | BLOCKED |
| B12 mixed-variable detector | Map MCQ4 + TF2 by snapshot IDs | Unsupported by current global-count detector | BLOCKED FOR PHASE C |

The attempted host dry-run failed before detector execution with
`ModuleNotFoundError: No module named 'cv2'`. Static inspection independently
confirms the global-count incompatibility above.

## Synthetic Marked Sheets

Not run. The generated PDFs were not modified into filled scan images because
the detector runtime dependency (`cv2`) is unavailable in the host
environment. No fabricated detector success is claimed.

## Required Phase C Detector Contract

Future detector input must consume:

```text
SHEET: snapshot_id, layout_schema_version, page_width_mm, page_height_mm,
       page_index, page_count
QUESTION: snapshot_question_id, page_index, normalized rect,
          global_question_number, question type
OPTION: snapshot_option_id, canonical_option_ordinal, normalized rect
OUTPUT: snapshot_question_id, snapshot_option_id, detected status,
        confidence, fill measurements, review warnings
```

The mapping must be identity-based, not only `question_number = 4` and
`choice = C`.

## Security

The finalized layout RPC returns labels, source identities, ordinals, and
geometry only. It does not return `is_correct`, answer keys, scores, or
grading secrets. Synthetic expected marks, where planned, remain local test
fixtures and are not part of the production layout response.

## Phase B Regression

- Phase B focused tests: 16 PASS / 0 FAIL.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run test:security`: 96 PASS / 0 FAIL / 4 SKIP.
- Local mixed snapshot smoke: PASS; schema version 2, option counts `[4,2]`,
  two questions, answer-key exposure false.
- Phase A.6 local runtime: PASS for idempotency and immutable source-aware
  regeneration.

## Remaining Gaps

### FAIL

- None observed in the generated PDF layouts covered here.

### BLOCKED

- Detector dry-run is blocked by missing host `cv2` and by the detector’s
  current global `choices_count` contract.
- Independent page-2 association is not guaranteed by the current printed
  identity.

### NOT RUN

- Headless QR rendering/visual inspection, because QR Canvas is unavailable.
- Filled-sheet detection for clean, shifted/scaled, and rotated cases.
- Physical scan acceptance.

### SKIPPED

- Four existing live authorization tests were skipped because staging
  security fixtures are unavailable.

## Verdict

NOT READY FOR PHASE C
