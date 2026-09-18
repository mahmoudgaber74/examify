# PHASE B.6 — TRUSTED PAGE-SET RUNTIME ACCEPTANCE REPORT

## Status

PARTIAL

## Local Runtime

- DB: persistent local Docker PostgreSQL/Supabase container
  `supabase_db_examify-phase-a6-canonical-b4a676bcd5894`.
- Prior Phase B migrations were already applied locally.
- Phase B.4 migration was applied locally and remains applied.
- No Cloud database, `db push`, deployment, or production data was used.

## Runtime Fixtures

One existing deterministic finalized v2 local snapshot was used for resolver
verification. It has one authoritative page. No five-page snapshot, second
snapshot, or second-tenant finalized fixture was available, so no synthetic
fixture rows were invented or persisted.

## Page Identity Resolution

| Page | Token Resolved | Authoritative Snapshot | Authoritative Page | Status |
|---|---|---|---:|---|
| existing local page 1 | YES | local finalized v2 sheet | 1/1 | PASS |

The resolver returned institution, sheet/snapshot, page index/count, and
layout schema version from database rows.

## Shuffled Page Runtime

NOT RUN. The local database has no five-page finalized fixture, and a one-page
fixture cannot prove order independence.

## Page Set Validation

| Case | Expected | Actual | Status |
|---|---|---|---|
| complete existing page set | VALID | `valid=true`, `page_count=1` | PASS |
| shuffled complete 4,1,5,2,3 | VALID | no five-page fixture | BLOCKED |
| duplicate | reject | `omr_page_set_duplicate` | PASS |
| missing | reject/incomplete | no multi-page fixture | BLOCKED |
| partial | reject/incomplete | no multi-page fixture | BLOCKED |
| cross-sheet | reject | no second finalized sheet fixture | BLOCKED |
| cross-snapshot | reject | no second finalized snapshot fixture | BLOCKED |
| cross-institution | reject | no second-tenant fixture | BLOCKED |

## Tamper / Invalid Input

| Case | Actual Result | Status |
|---|---|---|
| unknown UUID token | `omr_page_identity_not_found` | PASS |
| duplicate token | `omr_page_set_duplicate` | PASS |
| malformed `v2:` payload | QR reader rejects non-UUID token | PASS |
| unsupported layout version | v2 is blocked before legacy detector | PASS |
| cross-sheet token | worker sheet mismatch guard present; no second sheet fixture | BLOCKED |

## Authorization

`resolve_v2_page_identity(uuid)` and `validate_v2_page_set(uuid[])` have
EXECUTE revoked from PUBLIC, anon, and authenticated, and granted only to
`service_role`. Page table direct access is revoked from those roles. This
matches the server-owned worker architecture. The grants were inspected
locally; anon/authenticated HTTP calls were not attempted because no client
fixture is intended to execute these server-only RPCs.

## Authoritative Truth

YES. Page index, page count, snapshot/sheet, institution, and layout version
come from server-side `bubble_sheet_pages`/`bubble_sheets` rows, not QR claims.

## Exact Layout Handoff

Raster
→ QR Token
→ DB Identity
→ Snapshot Layout
→ Exact Page
→ V2 Processing Context

The resolver portion was executed successfully. Full raster-to-layout
handoff remains blocked because the persistent local fixture is one page and
the current detector intentionally stops before v2 geometry detection.

## V2 Processing Context

Sanitized context contract available from authoritative resolution:

```text
{
  bubble_sheet_id,
  snapshot_id,
  exam_id,
  institution_id,
  page_index,
  page_count,
  layout_schema_version
}
```

No answer key, score, grading result, or correctness field is returned.

## Fail-Closed Runtime

Can v2 accidentally enter the legacy detector? **NO**.

## Legacy Compatibility

Legacy layout version 1 continues through the existing detector path. No
legacy migration or scoring behavior was changed.

## Database Constraints

- `page_token` uniqueness: defined by a unique constraint; duplicate insert
  runtime attempt was not performed against live rows.
- `bubble_sheet_id + page_index` uniqueness: defined by a unique constraint;
  runtime duplicate-insert test was not performed.
- Resolver and duplicate page-set rejection were runtime-tested locally.

## Regression

- Phase B static: 6/6 PASS.
- QR: 20/20 DPI checks and 4/4 rotation/scale checks PASS from B.5.
- Page-set runtime: 2 PASS, remaining multi-page cases BLOCKED.
- OMR pytest: 6 PASS, 1 warning.
- Authorization/security: 97 PASS, 0 FAIL, 4 SKIP.
- Typecheck: PASS.
- Lint: 0 errors, 30 warnings.
- Build: PASS.

## Remaining Gaps

### FAIL

- None observed in executed tests.

### BLOCKED

- Five-page persistent finalized snapshot fixture.
- Full shuffled-page runtime.
- Missing/partial multi-page validation.
- Cross-sheet, cross-snapshot, and cross-institution runtime tests.
- Full detector-context handoff runtime.

### NOT RUN

- Cloud execution, deployment, provider delivery, and Phase C detector.

### SKIPPED

- Four live security tests due unavailable isolated staging fixtures.

## Verdict

NOT READY FOR PHASE C
