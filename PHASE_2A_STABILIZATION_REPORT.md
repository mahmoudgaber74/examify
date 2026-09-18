# PHASE 2A Stabilization Report

Date: 2026-09-05  
Scope: critical stabilization and security blockers only. Phase 2B was not started.

## Summary

Phase 2A implemented the deployment and runtime guardrails that could be safely completed statically. Camera/microphone access is now same-origin scoped, OMR authentication fails closed outside explicitly declared local development, Tutor recording cleans up on unmount, and the security suite now has an explicit strict-fixture mode for CI. Migration and live authorization verification remain blocked by the unavailable local Supabase instance and absent staging fixtures.

## Files changed

- `vercel.json`
- `src/views/Tutor.tsx`
- `services/omr-service/app/config.py`
- `services/omr-service/app/worker.py`
- `services/omr-service/docker-compose.yml`
- `services/omr-service/docker-compose.production.yml`
- `security/idor-authorization.test.mjs`
- `.github/workflows/security-audit.yml`
- `PROJECT_AUDIT_REPORT.md`

## Files created

- `MIGRATION_VERIFICATION_REPORT.md`
- `GRADE_PUBLICATION_DESIGN.md`
- this report

## Issues fixed

### Capability policy conflict — IMPLEMENTED BUT NOT VERIFIED

- Original problem/root cause: deployment sent `camera=(), microphone=()` while ExamRunner and Tutor requested those capabilities.
- Implementation: changed the header to `camera=(self), microphone=(self), geolocation=()`.
- Security impact: capabilities remain unavailable to other origins while the application origin can request them.
- Regression risk: browser support and deployment-origin behavior still need testing.
- Verification performed: inspected both requesting components and the resulting Vercel header.
- Remaining verification: HTTPS staging browser checks for allow, deny, iframe, and cleanup behavior.

### OMR token defaults — IMPLEMENTED BUT NOT VERIFIED

- Original problem/root cause: service and worker defaulted to a predictable token.
- Implementation: production/default process startup now raises when `OMR_SERVICE_TOKEN` is absent; local fallback requires explicit `OMR_ENVIRONMENT=development` (or another documented local/test value). Production Compose remains required-secret based.
- Security impact: missing production secrets fail closed instead of enabling guessable request authentication.
- Regression risk: local callers must declare development mode or provide a token.
- Verification performed: inspected API config, worker, and both Compose files; no production default remains in executable config.
- Remaining verification: container startup tests with missing/valid secrets and HMAC compatibility tests.

### Tutor recorder lifecycle — IMPLEMENTED BUT NOT VERIFIED

- Original problem/root cause: an active MediaStream could survive component unmount.
- Implementation: retained the stream in a ref and stops recorder/tracks during unmount and normal stop.
- Security impact: reduces unintended microphone lifetime.
- Regression risk: unmount while recording discards an in-progress recording.
- Verification performed: static lifecycle inspection.
- Remaining verification: browser permission denial, unmount, and repeated start/stop tests.

### Security-fixture readiness — IMPLEMENTED BUT NOT VERIFIED

- Original problem/root cause: missing fixtures were always skipped, allowing CI to appear green without authorization coverage.
- Implementation: `REQUIRE_SECURITY_FIXTURES=true` turns missing-fixture skips into test failures; local default remains an explicit `SKIPPED` result. CI sets the strict flag.
- Security impact: staging CI cannot silently pass without tenant-A/tenant-B fixtures.
- Regression risk: CI is intentionally red until all staging secrets/fixtures exist.
- Verification performed: inspected test branches and workflow environment.
- Remaining verification: execute against isolated staging and confirm PASS/FAIL behavior.

### Migration and publication review — BLOCKED / DESIGN COMPLETE

- Original problem/root cause: 57 migrations contain historical rewrites and the two UI publication paths are not atomic.
- Implementation: produced the ordered inventory, tenant matrix, and exact publication design. No migration was added because the existing Phase 3 cleanup is the intended forward migration and ownership must not be guessed offline.
- Security impact: makes deployment and refactor risks explicit without claiming runtime verification.
- Regression risk: unresolved until staging replay and publication tests.
- Verification performed: static migration/policy/function search.
- Remaining verification: disposable database replay, effective-policy inspection, orphan counts, and live IDOR tests.

## Security tests

`npm run test:security` remains locally runnable with explicit skips when fixtures are absent. CI now sets `REQUIRE_SECURITY_FIXTURES=true`, so missing staging fixtures fail the job. No credentials or fixture values were added to the repository.

## Build/lint/typecheck results

To be populated with the command results from this Phase 2A run below:

- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS** (0 errors, 29 existing warnings)
- `npm run build`: **PASS** (large-chunk, Browserslist, and Mammoth `eval` warnings remain)
- `npm run test:security`: **PASS WITH 4 EXPLICIT SKIPS** locally; strict mode was separately verified to exit nonzero when fixtures are absent
- `python -m pytest -q` in `services/omr-service`: **BLOCKED** (`pytest` is not installed)
- `python -m compileall -q services/omr-service`: **PASS**

## Database verification status

**BLOCKED.** Local Supabase/PostgreSQL is unavailable. No reset, migration application, production mutation, or simulated database success was performed.

## Remaining P0 issues

- Staging browser verification of camera/microphone policy and permissions.
- Apply and verify the ordered migration chain in a disposable database or isolated staging clone.
- Execute live cross-tenant IDOR and role tests with real fixtures.

## Recommended Phase 2B scope

1. Implement the idempotent server-side grade publication RPC/outbox design after product approval.
2. Replay migrations and inspect final `pg_policies`, functions, constraints, and orphan counts.
3. Run the strict security suite against isolated tenant fixtures.
4. Resolve remaining audio Tutor/provider and marketplace/payment findings from the audit.
