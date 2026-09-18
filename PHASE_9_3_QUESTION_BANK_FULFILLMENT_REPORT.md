# Phase 9.3 Question Bank Fulfillment Report

Verification date: 2026-09-05. Local Supabase was running; Phase 9.3 migrations were applied with `supabase db push --local --include-all`. No payment provider was selected or integrated.

## Suitability Decision

PASS. The existing Question Bank UI stores institution-owned questions, but had no bank aggregate. A minimal `question_banks` resource was added and questions now link to it through `questions.question_bank_id`. Existing institution/staff access rules remain intact; Marketplace access is an additional exact-entitlement read path.

## Product Type

Only `question_bank` is actionable in this phase. Course, learning path, exam template, and digital-resource placeholders remain visible only as unavailable catalog entries and are rejected by the add-to-cart RPC.

## Product → Question Bank Mapping

PASS. `marketplace_products.question_bank_id` is a real FK to `question_banks.id`. The mapping RPC sets product type, fulfillment target, text target key, and FK together. It validates a published bank and requires the institution manager to own the product and share the institution.

## Mapping Authorization

PASS. Institution Admin A mapped its own bank; mapping to Institution B’s bank was denied. Buyers have no mapping execute privilege. The mapping is not accepted from arbitrary frontend metadata.

## Entitlement Contract

An active entitlement to a Question Bank grants read access to exactly that published bank’s questions and buyer-safe options. It grants no institution membership, staff rights, edit/delete rights, access to other banks, or access to tenant records.

## Trusted Activation

`activate_marketplace_entitlement(order_id)` requires a paid order, a `question_bank` product, a valid FK target, and a published bank. It is callable only by `service_role`; `PUBLIC`, `anon`, and `authenticated` execute privileges are revoked. Local paid state was provisioned by service role as `test-fixture-payment-verified`, never by the browser.

## Activation Idempotency

PASS. Sequential trusted activation returned the same entitlement and preserved one order-item entitlement. Active buyer/target uniqueness and order-item uniqueness protect logical access.

## Activation Concurrency

PASS. Two simultaneous trusted activations returned one logical entitlement. The activation RPC now uses a buyer/target advisory lock plus `ON CONFLICT DO NOTHING` and returns the existing target entitlement on retry.

## Question Bank Access Consumer

PASS. `get_marketplace_question_bank(product_id)` is the actual server-side consumer. It requires the caller’s active entitlement for the exact product/target and a published bank, then returns question prompts, type, points, and option labels without `is_correct`.

## Buyer-Visible Data

Buyer-visible data is prompt/type/points and option IDs, labels, and sort order. Correct-answer flags and teacher-only question-management fields are not returned by the Marketplace consumer. Direct question-option access remains staff/academic-flow controlled.

## Entitled Access

PASS. Buyer A’s active entitlement allowed reading Question Bank A through the consumer RPC, including its dependent question content.

## Non-Entitled Denial

PASS. Buyer B received `question_bank_access_denied` for Bank A.

## Cross-Buyer IDOR

PASS. Buyer B could not read Bank A, despite knowing the product/bank context. Entitlement rows remain buyer-scoped.

## Cross-Tenant Isolation

PASS. Institution B staff could not read Institution A’s bank through normal Question Bank access, and Buyer access was limited to the explicitly entitled target without institution-wide visibility.

## Write Protection

PASS. An entitled buyer could not update/delete the bank, update the question, or insert question options. Purchase access is read-only.

## Product Unpublish Behavior

PASS. Unpublishing the product blocked new add-to-cart, while an existing active entitlement continued to read the purchased bank. This is the permanent-purchase policy.

## Resource Archive/Delete Behavior

Archiving the underlying bank made the consumer return unavailable while preserving entitlement and order history. The bank and product foreign keys use `ON DELETE RESTRICT`, preventing destructive deletion from silently breaking fulfillment records.

## Repeat Purchase Rule

The current server prevents duplicate logical active access per buyer and Question Bank target. The UI recognizes active ownership and disables adding an owned product. Payment/order duplicate purchase policy remains conservative and should be finalized with provider business rules.

## Owned UI State

PASS. Marketplace queries active buyer entitlements, shows `مملوك`, and disables the add button for owned products. No test activation or mark-paid control is exposed.

## Regression Results

- `npm run test:marketplace:question-bank:local`: **15 PASS, 0 FAIL, 0 HARNESS_ERROR**.
- `npm run test:marketplace:local`: **23 PASS, 0 FAIL**.
- `npm run test:marketplace:fulfillment:local`: **3 PASS, 0 FAIL**.
- `npm run test:marketplace:static`: **3 PASS, 0 FAIL**.

## Product Bugs

The first activation concurrency run exposed a real duplicate-key race; it was fixed with advisory locking and conflict-safe idempotent return. Fixture provisioning also required server-only grants for the new resource tables. No remaining local P0/P1 fulfillment defect was found.

## Files Changed

- `src/views/Marketplace.tsx`
- `package.json`
- `marketplace-question-bank-fulfillment-test.mjs`
- `marketplace-fulfillment-api-test.mjs`
- `marketplace-integrity-api-test.mjs`
- `security/marketplace-static.test.mjs`
- `scripts/setup-local-security-fixtures.mjs`
- `PHASE_9_3_QUESTION_BANK_FULFILLMENT_REPORT.md`

## Migrations Added

`20260905210000_phase9_3_question_bank_fulfillment.sql`, `20260905220000_phase9_3_question_bank_fixture_grant.sql`, `20260905230000_phase9_3_question_bank_fixture_grants.sql`, `20260905240000_phase9_3_fulfillment_fixture_grants.sql`, `20260905250000_phase9_3_trusted_activation_grant.sql`, `20260905260000_phase9_3_activation_concurrency_fix.sql`, and `20260905270000_phase9_3_question_bank_only_catalog.sql`. All were applied locally. Existing Phase 9.1/9.2 migrations were not rewritten.

## Remaining Gaps

Payment provider/webhook selection and implementation remain deferred. Refund-triggered revocation is design-only. The product catalog still contains legacy placeholder rows, which are intentionally non-actionable until mapped to real resources. Production staging verification and load testing remain required.

## Payment Readiness

**READY FOR PROVIDER SELECTION.** A verified future payment can now transition an order through the trusted activation boundary to a real, exact, read-only Question Bank entitlement. The payment provider itself remains unimplemented.

## Final Status

**PHASE 9.3 — QUESTION BANK FULFILLMENT VERIFIED LOCALLY**
