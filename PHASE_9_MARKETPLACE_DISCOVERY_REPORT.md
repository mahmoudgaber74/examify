# Examify AI — Phase 9 Marketplace Discovery Report

Audit mode: discovery and architecture only. No Marketplace production implementation or payment integration was performed.

## Executive Status

Marketplace is a partially implemented catalog/cart/order-intent surface. The catalog and cart/order RPCs are database-backed, but payment, entitlement activation, seller ownership, reviews, downloads, and admin Marketplace management are not complete or verified. The UI still contains fabricated commercial metrics and seller revenue-sharing claims.

## Marketplace Architecture Map

- Route: `App.tsx` view `marketplace` → `src/views/Marketplace.tsx`.
- Frontend state: products and cart fetched through Supabase; favorites are local component state.
- Catalog: `marketplace_products`.
- Cart: legacy `cart_items`, with `add_marketplace_item_to_cart(text)`.
- Orders: `marketplace_orders` and `marketplace_order_items`, with `create_marketplace_order(text)`.
- Entitlements: `marketplace_entitlements` table exists, but no activation workflow was found.
- Payment: no provider, webhook, Edge Function, or server verification flow found.
- Storage: no Marketplace-specific private asset bucket or entitlement-aware download RPC found.
- Tests: no Marketplace-specific runtime or static test suite found.

Flow currently is: database catalog → UI filter/search → server cart insert → server pending order and order items → cart deletion. It stops at `pending`; there is no paid transition or access grant.

## Feature Inventory

| Capability | Status | Evidence / limitation |
|---|---|---|
| Product catalog | IMPLEMENTED BUT NOT VERIFIED | `marketplace_products` query and active-product RLS exist |
| Categories/types | PARTIALLY WORKING | Type mapping exists; no category model |
| Search | PARTIALLY WORKING | Client-side title/author filtering |
| Filters | PARTIALLY WORKING | Client-side type filter |
| Product detail | UI ONLY | Cards only; no detail route |
| Cart | PARTIALLY WORKING | DB-backed, but legacy schema and quantity handling are incomplete |
| Checkout | PARTIALLY WORKING | Creates a pending order; payment explicitly unavailable |
| Orders/order items | IMPLEMENTED BUT NOT VERIFIED | Server RPC creates authoritative totals/items |
| Payment | NOT IMPLEMENTED | No provider or webhook |
| Entitlement | NOT IMPLEMENTED | Table exists; no legitimate activation path |
| Seller data | UI ONLY | Static seller/revenue claims; no seller table |
| Reviews/ratings | MOCK / DEMO / FAKE | UI displays fabricated aggregate and zero per-card values |
| Revenue metrics | MOCK / DEMO / FAKE | Hardcoded dashboard figures and splits |
| Download/access | NOT IMPLEMENTED | No entitlement-aware asset delivery |
| Admin management | NOT IMPLEMENTED | No Marketplace admin RPC/UI found |

## Mock/Demo/Fake Findings

Confirmed fabricated commercial claims in `Marketplace.tsx`: `$1.24M`, `4,820` active sellers, `18,400` listed items, `4.8/5`, static `70/30`, `80/20`, and `85/15` seller/platform splits, “after 100 sales,” institutional contracts, `Trending` labels, and per-card sales/rating fields set to `0` rather than sourced metrics. The product list itself is fetched from the database, but its author is hardcoded to `—`, and rating/sales are hardcoded to zero.

## Product Ownership Model

The current schema represents a generic digital product with ID, title, price, type, cover URL, and active flag. There is no product owner, seller, institution, asset reference, publication audit, or version model. Ownership is therefore undefined and cannot safely support seller publishing or paid access.

## Marketplace Tenancy Model

Current catalog behavior is effectively cross-institution/global: authenticated users can read active `marketplace_products`, which has no institution column. Orders and entitlements are buyer-user scoped. This can be a valid hybrid model only if the catalog is intentionally global and private buyer/order data remains user-scoped; institution-private products are not representable today.

## Catalog Authority

Product IDs and prices are read server-side by `create_marketplace_order`; the RPC calculates total from active database products and stores title/unit price in order items. Browser cart price is displayed but is not authoritative for order creation. Currency is server-defaulted to `USD`. Product availability is checked by `is_active`, but price/version snapshots and removed-product behavior need explicit tests.

## Price Authority

PASS by source inspection for the current order RPC: the final subtotal/total is calculated from `marketplace_products`, not accepted from the browser. Discounts, tax, quantities, currency selection, and price-change policy are not implemented.

## Cart Architecture

Hybrid/legacy. The UI reads `cart_items`; the add RPC uses the authenticated user and authoritative product price. The UI prevents duplicate items locally and the RPC returns an existing user/item row. The current order RPC sums one row per active cart item, has no quantity model, clears the cart after order creation, and lacks explicit transaction/idempotency locking for concurrent checkout races.

## Order State Machine

Implemented states are `pending`, `paid`, `failed`, `cancelled`, and `refunded`, but only `pending` is produced. Intended safe lifecycle is `pending → payment_pending → paid → fulfilled` only after a real provider is selected; current schema does not include `payment_pending` or `fulfilled`, so this is a Phase 9.1 design decision rather than current behavior.

## Payment Truth Model

No real payment exists. The UI explicitly says payment is unavailable and the RPC sets `payment_provider = 'not_configured'`. A pending order is not a purchase, and no paid entitlement should be granted.

## Payment Provider Boundary

Future boundary: authoritative order creation → provider checkout session → signed webhook verification → event/idempotency/replay checks → order amount/currency/order matching → paid transition → server entitlement activation. Provider secrets must remain server-side. No imaginary provider implementation should be added.

## Entitlement Architecture

`marketplace_entitlements` exists with unique `order_item_id`, buyer, product, and `pending|active|revoked` status. No RPC or trigger was found that changes a pending order into an active entitlement. Current evidence supports **no pending entitlement grant**, but activation and download authorization are NOT IMPLEMENTED.

## Asset/Download Security

No Marketplace asset storage/reference/download flow was found. Paid assets are therefore unavailable rather than safely downloadable. Future delivery must use a private bucket and an entitlement-aware server RPC for short-lived signed URLs.

## Seller Model

No seller table, seller identity, product owner, payout account, or seller authorization exists. Seller cards and tiers are UI fiction and must not be treated as product data.

## Reviews/Ratings

No persisted Marketplace review/rating table or RPC was found. The UI displays static aggregate `4.8/5` and static card values, so reviews and ratings are **MOCK / DEMO / FAKE**.

## Admin Authorization

No Marketplace admin create/edit/publish/archive/manage-seller workflow was found. Existing product rows are migration-seeded and active catalog read is available to authenticated users. Server-side management authorization is NOT IMPLEMENTED.

## Buyer IDOR Risks

Current order/order-item/entitlement SELECT policies are buyer-scoped in the Marketplace migration, but no dedicated runtime tests exist. Cart policy history includes permissive legacy policies before later hardening; effective deployed policy must be verified. Buyer A/B read, mutate, entitlement, and asset cases are NOT VERIFIED.

## Seller IDOR Risks

Seller ownership does not exist, so seller IDOR cannot be meaningfully tested. Any future seller model must scope product mutation and private orders by seller and institution server-side.

## Tenant Isolation

The catalog is global because products lack `institution_id`; this is a product-model decision, not strict institution isolation. Orders are user-scoped. If products should be institution-private, the current schema is insufficient and would be a P1 design/security defect.

## Idempotency

Order creation has `(user_id, idempotency_key)` uniqueness and checks an existing order, which is a good baseline. The concurrent race behavior and atomicity under duplicate requests are not runtime verified. Cart add is effectively duplicate-safe by user/item lookup but lacks a database unique constraint visible in the migration.

## Concurrency Risks

Unverified risks include duplicate cart rows, simultaneous checkout with the same cart, product deactivation during checkout, price changes, future webhook replay, and duplicate entitlement activation. Required protections are unique buyer/item and idempotency constraints, authoritative locked price calculation, atomic order/order-item/cart transition, webhook event uniqueness, and entitlement uniqueness.

## Transaction Boundaries

`create_marketplace_order` performs calculation, order insert, item insert, and cart delete in one function invocation, but no dedicated concurrency test or explicit row locks were found. Partial-write behavior must be tested against the live schema before commercial use.

## Auditability

No Marketplace-specific audit events for product publication, order creation, payment transition, entitlement activation, or revocation were found. General application audit infrastructure exists elsewhere but is not wired to this flow.

## Error/Empty States

Empty cart and order-creation failure are represented. Checkout truthfully says payment is unavailable. There is no product detail, unavailable/price-changed, order history, payment-provider failure, entitlement, download, or unauthorized asset state. Catalog load errors are not clearly surfaced in this view.

## Database/RLS Review

Current Marketplace migration enables RLS on products, orders, order items, and entitlements; product reads are active/authenticated, orders and entitlements are buyer-scoped, and order items are reachable through buyer-owned orders. Direct authenticated writes to orders/items/entitlements are revoked. The older `cart_items` schema is shared with legacy application data and has historical permissive policies; the effective current policy must be inspected before commercialization. No Marketplace-specific Storage bucket exists.

## Existing Tests

No Marketplace-specific test files were found. General local suites cover broader security/runtime behavior but do not prove Marketplace buyer/seller/payment/entitlement behavior. Baseline commands run: `npm run typecheck` PASS; `npm run lint` PASS with 29 warnings and 0 errors; `npm run build` PASS with large-chunk and Mammoth `eval` warnings.

## P0 Findings

None confirmed from source discovery. Payment is explicitly unavailable rather than falsely completed.

## P1 Findings

1. Remove fabricated financial, seller, rating, and sales claims before any Marketplace launch.
2. Define ownership/tenancy and add server-side product management authorization before seller workflows.
3. Implement and verify entitlement activation only after verified payment; never activate from `pending`.
4. Add private asset delivery with entitlement-aware signed URLs before selling downloads.
5. Execute buyer/seller/admin IDOR and order concurrency tests against staging/local fixtures.

## P2 Findings

1. Add product detail, order history, explicit unavailable/price-change states, and catalog error handling.
2. Add quantity/version/price snapshot rules and database uniqueness for cart items.
3. Add Marketplace audit events and bounded catalog/search queries.
4. Replace local favorites and static author/metrics with truthful product fields or empty states.

## Recommended Phase 9.1 Implementation Scope

1. Remove all fabricated metrics, ratings, seller tiers, and revenue claims; keep payment visibly unavailable.
2. Decide global versus institution-scoped catalog and encode ownership/publication fields.
3. Harden cart/order transaction and idempotency invariants with runtime tests.
4. Add truthful order history and pending/unavailable states without granting access.
5. Add buyer/admin IDOR tests and effective RLS verification.
6. Defer payment-provider integration until the catalog, ownership, asset security, entitlement, webhook, and audit boundaries are implemented.
