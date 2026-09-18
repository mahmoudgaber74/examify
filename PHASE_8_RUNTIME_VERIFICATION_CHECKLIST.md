# Phase 8 Runtime Verification Checklist

## AI grading

- [ ] Missing OpenAI key returns unavailable and stores no score.
- [ ] Timeout/rate-limit/provider failure returns an explicit error.
- [ ] Answer reference from another tenant is rejected.
- [ ] Client max score/question text cannot override database values.
- [ ] Negative, over-max, unknown-criterion, duplicate, malformed, and partial AI results are rejected.
- [ ] Teacher approval is bounded, scoped, audited, and cannot modify a published attempt.
- [ ] Repeated approval is idempotent and does not publish.

## OMR

- [ ] Invalid file, corrupt PDF/image, excessive size/pages, and wrong template are rejected.
- [ ] Missing/invalid HMAC, old timestamp, changed body, and replayed request are rejected.
- [ ] Wrong institution, student, exam, assignment, or Storage path cannot be processed.
- [ ] Low confidence, blank, multiple, unreadable, and QR mismatch states enter review.
- [ ] Worker retry and timeout do not create duplicate results.
- [ ] OMR correction preserves original extraction and records reviewer/timestamp.
- [ ] Repeat approval returns the same result and does not double-write scores.
- [ ] Approved OMR answers enter canonical `answers` and remain unpublished until result publication.

## Certification

- [ ] Failed, draft, unpublished, AI-only, and unresolved OMR results cannot issue certificates.
- [ ] Valid passed published result issues one certificate.
- [ ] Concurrent/repeated issuance returns one certificate.
- [ ] Unauthorized and cross-tenant issuance/revocation fail.
- [ ] Valid credential returns `VALID`; revoked returns `REVOKED`; fake credential returns `NOT_FOUND`.
- [ ] Verification exposes no unnecessary internal IDs or private data.
- [ ] Certificate identifier and score cannot be client-supplied.

## Staging execution

- [ ] Apply migrations from a clean disposable database.
- [ ] Deploy Edge Functions and configure provider/OMR secrets.
- [ ] Install Python test dependencies and run OMR pytest suite.
- [ ] Run `npm run test:security` with isolated tenant A/B fixtures.
- [ ] Run two AI requests, two OMR approvals, two certificate issuances, and concurrent publication requests.
- [ ] Capture logs and audit rows for every accepted/rejected transition.

