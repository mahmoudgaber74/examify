/* Institution-owned products cannot become orphaned when a tenant is deleted. */
ALTER TABLE public.marketplace_products
  DROP CONSTRAINT IF EXISTS marketplace_products_institution_id_fkey;
ALTER TABLE public.marketplace_products
  ADD CONSTRAINT marketplace_products_institution_id_fkey
  FOREIGN KEY (institution_id) REFERENCES public.institutions(id) ON DELETE RESTRICT;
