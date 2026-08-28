-- Optional metadata for multi-section Bubble Sheet templates.
-- The OMR engine continues to use the existing exam_id and global question order.
ALTER TABLE public.bubble_sheets
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bubble_sheets.sections IS 'Composite sheet sections: [{"title":"لفظي","questionsCount":13}]';
