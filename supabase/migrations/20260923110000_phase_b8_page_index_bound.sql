-- Phase B.8: keep every persisted page index within its row's authoritative page count.
-- Existing rows are validated by ALTER TABLE before this constraint is committed.
ALTER TABLE public.bubble_sheet_pages
  ADD CONSTRAINT bubble_sheet_pages_page_index_within_count_check
  CHECK (page_index >= 1 AND page_index <= page_count);
