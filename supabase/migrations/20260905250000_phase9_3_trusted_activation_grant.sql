/* Only the trusted server role may invoke fulfillment activation. */
GRANT EXECUTE ON FUNCTION public.activate_marketplace_entitlement(uuid) TO service_role;
