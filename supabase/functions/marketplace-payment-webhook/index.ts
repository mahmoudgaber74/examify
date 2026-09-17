/**
 * Provider-neutral webhook boundary.
 * A future adapter must authenticate and normalize a provider event before
 * calling process_verified_marketplace_payment_event. This function fails
 * closed until an adapter is deliberately configured; it never mutates order
 * or entitlement state on its own.
 */
interface NormalizedPaymentEvent {
  provider: string;
  eventId: string;
  paymentId: string;
  orderId: string;
  type: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  amount: number;
  currency: string;
}

interface PaymentProviderAdapter {
  verifyAndNormalize(request: Request, rawBody: string): Promise<NormalizedPaymentEvent>;
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ code: 'method_not_allowed' }, 405);
  const rawBody = await request.text();
  const adapter: PaymentProviderAdapter | undefined = undefined;
  if (!Deno.env.get('PAYMENT_PROVIDER_ADAPTER') || !adapter) {
    return json({ code: 'provider_not_configured', message: 'No payment provider adapter is configured.' }, 503);
  }
  // Adapter integration is intentionally absent in this phase. Any future
  // implementation must call the normalized verified-event RPC only.
  void rawBody;
  return json({ code: 'provider_not_configured' }, 503);
});
