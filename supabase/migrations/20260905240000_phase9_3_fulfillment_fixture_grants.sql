/* Trusted local/Edge role grants; browser roles retain no direct fulfillment writes. */
GRANT ALL ON public.marketplace_products, public.marketplace_orders, public.marketplace_order_items, public.marketplace_entitlements TO service_role;
