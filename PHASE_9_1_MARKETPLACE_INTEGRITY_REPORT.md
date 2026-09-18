# Phase 9.1 Marketplace Integrity Report

Verification date: 2026-09-05. Local Supabase was running and the two Phase 9.1 migrations were applied with `supabase db push --local --include-all`.

## Previous Marketplace Status

The Marketplace was a partially implemented catalog/cart/order-intent surface. It displayed fabricated financial, seller, rating, and sales claims; had no product ownership model or private management boundary; and had no Marketplace-specific runtime tests. Payment, entitlement activation, downloads, reviews, and seller financials were not implemented.

## Fake/Demo Data Removed

Removed the hardcoded `$1.24M`, `4,820`, `18,400`, `4.8/5`, seller tiers, revenue splits, trending labels, and per-card rating/sales presentation from `src/views/Marketplace.tsx`. Products and cart state now come from Supabase. Ratings and sales are explicitly unavailable. Checkout is explicitly a pending order intent; no payment or paid ownership is claimed.

## Product Ownership

`marketplace_products` now has `owner_type`, `owner_user_id`, and `institution_id`. Existing seeded products are platform-owned. Institution-owned products require an institution scope and owning school administrator. Platform product management is reserved for `super_admin`.

## Tenancy Model

The catalog is intentionally global for published active products. Management is institution-scoped for institution products. Cart rows retain the existing non-null `institution_id` invariant and are assigned from the authenticated user’s current institution.

## Product Authorization

Direct product writes are revoked. Create, update, and active/archive operations are SECURITY DEFINER RPCs with role and institution/owner checks. The local runtime test verified an ordinary teacher cannot create an institution-B product. A positive school-admin management test requires a school-admin fixture and remains unverified.

## Seller Model

No seller marketplace role, seller onboarding, or payout model is claimed. Institution ownership is the only implemented non-platform ownership mode.

## Admin Scope

`super_admin` may manage platform products. A `school_admin` may manage only institution-owned products in the administrator’s current institution and owned by that administrator. Cross-tenant administrator cases require additional local role fixtures and are not counted as executed.

## Cart Security

Cart SELECT/INSERT/DELETE is authenticated-user scoped. Direct INSERT/UPDATE/DELETE grants are revoked; add-to-cart is through an authoritative RPC. A partial unique index prevents duplicate user/product rows, and repeated adds update the server snapshot rather than creating another row.

## Price Authority

The browser sends only a product ID. Add-to-cart and checkout read the current product price from the database. The runtime test verified that a direct forged cart price is rejected and that the order total equals the database product price.

## Order Transaction

Checkout locks the user/idempotency key with `pg_advisory_xact_lock`, locks relevant cart/product rows, computes the total from active database products, snapshots order items, and clears the user cart in one transaction.

## Order States

The current truthful state is `pending` with `payment_provider = 'not_configured'`. No UI or RPC grants paid access from a pending order.

## Order Idempotency

The existing `(user_id, idempotency_key)` unique constraint is retained. A repeated key returns the existing order. The runtime test passed sequential idempotency.

## Checkout Concurrency

Two simultaneous same-key calls returned one order ID and one database order row locally. This is a local transaction test, not a production-scale load test.

## Entitlement Trust Model

Entitlements remain server-created records. A pending order creates no entitlement, and no normal buyer entitlement activation RPC was added.

## Entitlement Authorization

Buyer direct entitlement insertion was rejected locally, and buyer B could not read buyer A’s order. Full paid-to-entitlement activation is NOT IMPLEMENTED because payment is not integrated.

## Private Asset Architecture

NOT IMPLEMENTED / NOT APPLICABLE to the current catalog: no Marketplace asset bucket, asset reference, download RPC, or signed entitlement-aware download path exists. Products must remain non-downloadable until that architecture is implemented.

## Reviews/Ratings Truthfulness

No review/rating table or verified aggregation exists. The UI now states that ratings and sales are unavailable and does not show fabricated values.

## Seller Financial Truthfulness

No revenue, sales, seller tier, commission, payout, or financial metric is displayed or claimed. No financial model is implemented.

## Buyer IDOR

Local runtime coverage passed buyer A/B cart and order isolation and direct entitlement denial. The existing broader IDOR baseline was not rerun because shared authorization helpers were not changed.

## Admin/Seller IDOR

The teacher-to-institution-B management attempt was denied. Cross-tenant school-admin and positive authorized-admin cases are not executed because the fixture set lacks those role sessions.

## RLS Verification

RLS was applied locally and the effective Marketplace/cart policies were exercised through authenticated clients. `supabase db lint --local` completed with five pre-existing warnings and no new Marketplace error. Live staging RLS remains required before production claims.

## Marketplace Runtime Tests

`npm run test:marketplace:local`: **23 PASS, 0 FAIL, 0 HARNESS_ERROR**. `npm run test:marketplace:static`: **2 PASS, 0 FAIL**. The expanded run covered catalog visibility, authoritative add, cart read/update/delete isolation, duplicate add concurrency, order and order-item isolation/mutation denial, entitlement isolation/self-grant denial, price tampering, historical price snapshot, price change before checkout, unpublished checkout, sequential/concurrent idempotency, safe invalid checkout atomicity, institution-admin positive management, ordinary-buyer denial, cross-institution denial, and super-admin-only platform management.

## Files Changed

- `src/views/Marketplace.tsx`
- `src/lib/data.ts` was not needed for the final Marketplace type; the view now uses a backend-shaped local catalog type and does not populate rating/sales mocks.
- `package.json`
- `marketplace-integrity-api-test.mjs`
- `security/marketplace-static.test.mjs`
- `supabase/migrations/20260905100000_phase9_1_marketplace_integrity.sql`
- `supabase/migrations/20260905120000_phase9_1_cart_tenant_fix.sql`
- `supabase/migrations/20260905130000_phase9_1_product_tenant_fk.sql`
- `scripts/setup-local-security-fixtures.mjs`

## Migrations Added

`20260905100000_phase9_1_marketplace_integrity.sql`, `20260905120000_phase9_1_cart_tenant_fix.sql`, and `20260905130000_phase9_1_product_tenant_fk.sql`; all three were applied locally. The second migration fixes the discovered existing `cart_items.institution_id NOT NULL` integration requirement. The third prevents institution-owned products becoming orphaned on tenant deletion.

## Product Bugs Found

The first local execution found that the new add-to-cart RPC omitted required `cart_items.institution_id`, causing every add to fail. This was a real integration defect, not a test setup error.

## Product Bugs Fixed

The add-to-cart RPC now derives and stores the authenticated user’s institution ID, while rejecting users without an institution. Fresh installs and the already-running local database are both covered by the migrations.

## Remaining Gaps

Payment/provider integration, paid entitlement activation, private Marketplace assets/downloads, reviews, seller payouts, positive school-admin management, cross-tenant admin fixtures, and production-scale load testing remain incomplete or unverified. These are explicit non-claims.

## Payment Integration Readiness

Not ready for payment integration or commercialization. The server boundary is prepared for a future provider, but no provider, webhook, payment verification, entitlement activation, refund, or chargeback flow exists.

## Final Phase 9.1 Status

**PHASE 9.1 — LOCAL MARKETPLACE CORE VERIFIED.** The expanded local core passed 25 assertions (23 runtime + 2 static), with no local authorization or integrity failure. Payment, secure fulfillment, reviews, and seller economics remain explicitly unavailable.

## Existing 14 Assertion Coverage

The original 14 assertions covered: active catalog read, authoritative add-to-cart, buyer cart isolation, duplicate add, forged cart-price rejection, server-price checkout, pending/no-entitlement, sequential idempotency, buyer order isolation, self-grant denial, ordinary-teacher management denial, and concurrent same-key checkout, plus two static checks for fabricated UI claims and migration controls. They did not cover admin positives, price snapshots, unpublished checkout, cart concurrency, transaction atomicity, or full order/entitlement IDOR.

## Buyer IDOR Runtime

**23/23 PASS overall expanded run.** Buyer A could read its own cart/order; Buyer A could not read, update, or delete Buyer B’s cart; could not read or mutate Buyer B’s order/items; could not read Buyer B’s entitlement; and direct entitlement creation was denied.

## Admin Authorization Runtime

Institution Admin A created/updated its own institution product. Institution Admin B was denied mutation of A’s product. An ordinary buyer was denied management. Super Admin created a platform product, and Institution Admin A was denied platform-product mutation.

## Price Tampering Runtime

PASS. Direct order insertion with negative total, forged subtotal, and alternate currency was rejected; checkout accepts only an idempotency key and derives price server-side.

## Order Price Snapshot

PASS. Changing the current product price after order creation did not change the stored `marketplace_order_items.unit_price`.

## Price Change During Checkout

PASS. A cart created at price A produced an order at current database price B.

## Unpublished Product Checkout

PASS. Archiving a product after it was added caused checkout to reject with no order. The test removed the retained unavailable cart row before restoring the fixture product.

## Sequential Checkout Idempotency

PASS. A repeated key returned the same logical order and exactly one order item.

## Checkout Concurrency

PASS. Two simultaneous checkout calls with one key resolved to one order ID and one final order row.

## Cart Concurrency

PASS. Two simultaneous add-to-cart calls produced one logical cart item through the unique user/product rule.

## Transaction Atomicity

PASS for the safe invalid/empty checkout path: the RPC rejected before insert and left no order. A forced mid-transaction database fault was not introduced, so this is not a failure claim for arbitrary infrastructure errors.

## Entitlement Self-Grant Protection

PASS. Direct buyer insertion was rejected and pending checkout produced no entitlement. No paid fulfillment consumer currently exists.

## Effective Marketplace RLS

PASS locally through authenticated sessions for products, cart, orders, order items, and entitlements. Database lint completed with five pre-existing warnings unrelated to Marketplace. Staging verification remains required.

## Seller Model Final Decision

`SELLER MODEL — NOT IMPLEMENTED / NOT REQUIRED FOR CURRENT MARKETPLACE CORE`. No seller role, payout, tier, or earnings claim remains. Seller IDOR is NOT_APPLICABLE.

## Private Asset Requirement Decision

`PRIVATE MARKETPLACE ASSET DELIVERY — NOT IMPLEMENTED; DEFERRED UNTIL PRODUCT TYPE REQUIRES IT`. Current Marketplace has no paid/private downloadable asset or download consumer.

## Entitlement Fulfillment Model

The entitlement table is a server-owned placeholder linked to order items. No current application consumer unlocks a resource from it, and pending orders do not create active entitlements. Therefore: `ENTITLEMENT ACTIVATION PIPELINE INCOMPLETE`.

## Phase 9.1 Final Local Status

**PHASE 9.1 — LOCAL MARKETPLACE CORE VERIFIED.** All currently applicable local Marketplace core gates executed: 23 runtime assertions passed, with no local authorization or integrity failure. Non-core fulfillment, reviews, seller economics, and payment remain explicitly unavailable.

## Payment Integration Readiness

**NOT_READY.** Order authority, price authority, truthful pending state, idempotency, and authorization are locally verified, but the application has no secure fulfillment/entitlement consumer for a successful payment. Do not integrate a provider in this phase.
