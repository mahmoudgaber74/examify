# Phase 9.4 — Payment Core Report

Date: 2026-09-05

## Final status

**PHASE 9.4 — PAYMENT CORE VERIFIED LOCALLY; REAL PROVIDER INTEGRATION NOT IMPLEMENTED**

No real payment provider was selected or called. The local database accepted both forward migrations and the provider-neutral core test completed 19/19 assertions.

## Payment domain model

Added `marketplace_payments` as a separate payment-attempt table and `marketplace_payment_events` for immutable normalized event identities. One order may have multiple attempts, while a partial unique index permits only one `paid` payment per order. Provider payment IDs and provider event IDs are unique in their provider scope.

The current order model remains `pending | paid | failed | cancelled | refunded`. Payment attempts use `created | pending | paid | failed | cancelled | refunded`. A verified `paid` event transitions the payment and pending order, then reuses the existing Phase 9.3 trusted Question Bank entitlement activation in the same transaction. Activation failure rolls back the payment/order transition.

## Server authority and idempotency

`create_marketplace_payment(order_id, client_idempotency_key)` authenticates the buyer and derives ownership, amount, currency, and fulfillment target validity from the order snapshot. It never accepts browser amount, currency, provider, paid status, or entitlement data. The current provider is deliberately `unconfigured`; creation returns a truthful `created` attempt and does not claim payment success.

The verified-event RPC is executable only by `service_role`, uses row/advisory locks, records normalized event identity, prevents paid-state regression, and calls the existing trusted activation RPC. Direct authenticated inserts/updates/deletes are revoked by grants and RLS.

## Provider adapter and webhook boundary

Added `supabase/functions/marketplace-payment-webhook/index.ts` with a provider-neutral `PaymentProviderAdapter` and normalized-event contract. It fails closed with `provider_not_configured` until a deliberately configured server-side adapter exists. It does not mutate orders or entitlements. No provider credentials, API calls, test controls, or test adapter are present in production UI/configuration.

The local Node test uses a clearly test-only HMAC helper to validate the invalid-signature/no-mutation boundary and uses the privileged local client only to provision controlled fixtures and submit already-normalized events. It is not a production provider implementation.

## Local test results

`npm run test:marketplace:payment:local`: **19 PASS / 0 FAIL**

Covered: own pending order, foreign order denial, derived amount/currency, sequential and concurrent attempt idempotency, paid-order retry denial, own/foreign status reads, direct mutation denial, pending/failed/success transitions, no entitlement before verified success, invalid signature, unknown provider/payment, amount/currency/order mismatch, success replay, out-of-order events, atomic entitlement activation, and concurrent verified success.

Regression checks: Marketplace integrity **23/23 PASS**; fulfillment **3/3 PASS**; Question Bank fulfillment **15/15 PASS**; Marketplace static **3/3 PASS**. `typecheck`, `lint`, `build`, and `supabase db lint --local` passed. Lint/db lint retained only pre-existing warnings.

## Refund, reversal, and audit design

Payment state includes `refunded`, and normalized events include cancellation/refund-compatible statuses. Entitlement revocation on refund is intentionally not implemented until a real provider/refund policy exists. Event rows preserve provider, event ID, payment ID, type, normalized status, amount, currency, occurrence time, and receipt time without raw card data, secrets, PAN, or CVV.

## Remaining blockers / not verified

- No real provider adapter, credentials, signature contract, provider redirect, or external API call was introduced by design.
- The Edge Function runtime was not available locally, so the deployed Edge Function request/response path and Deno execution remain **IMPLEMENTED BUT NOT VERIFIED**. The source is fail-closed.
- Twilio delivery, provider webhook delivery, refund/chargeback behavior, and staging RLS/migration verification remain external deployment checks.
- The current Marketplace UI intentionally continues to state that payment is unavailable and offers no payment-success button or browser authority path.

## Next phase gate

Phase 9.4 is complete for the provider-neutral local core. A later provider-adapter phase must define one real provider, implement server-side signature verification and initiation, configure secrets in staging, and execute provider sandbox tests before payment can be marketed or enabled.
