-- Add the remaining template identity needed to verify printed sheets.
-- Non-destructive: existing bubble sheets remain valid.
ALTER TABLE public.bubble_sheets
  ADD COLUMN IF NOT EXISTS qr_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS bubble_sheets_qr_token_unique
  ON public.bubble_sheets(qr_token);

ALTER TABLE public.bubble_sheets
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.bubble_sheets
  DROP CONSTRAINT IF EXISTS bubble_sheets_status_check;

ALTER TABLE public.bubble_sheets
  ADD CONSTRAINT bubble_sheets_status_check
  CHECK (status IN ('draft', 'active', 'retired'));
