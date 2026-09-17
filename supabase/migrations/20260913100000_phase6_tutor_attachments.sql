-- Phase 6: private Tutor attachments. Store paths, not public URLs.

ALTER TABLE public.tutor_messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type varchar(16);
ALTER TABLE public.tutor_messages
  DROP CONSTRAINT IF EXISTS tutor_messages_attachment_type_check;
ALTER TABLE public.tutor_messages
  ADD CONSTRAINT tutor_messages_attachment_type_check
  CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'audio'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tutor_attachments', 'tutor_attachments', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mpeg', 'audio/ogg'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

REVOKE ALL ON storage.objects FROM anon;
DROP POLICY IF EXISTS tutor_attachments_select ON storage.objects;
DROP POLICY IF EXISTS tutor_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS tutor_attachments_delete ON storage.objects;

-- Object paths are user_id/conversation_id/random-filename. Staff access is
-- limited to conversations belonging to their current institution.
CREATE POLICY tutor_attachments_select ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'tutor_attachments' AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR (
      public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
      AND EXISTS (
        SELECT 1 FROM public.tutor_conversations c
        WHERE c.id = NULLIF(split_part(name, '/', 2), '')::uuid
          AND (public.current_user_role() = 'super_admin' OR c.institution_id = public.current_user_institution_id())
      )
    )
  )
);

CREATE POLICY tutor_attachments_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'tutor_attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.tutor_conversations c
    WHERE c.id = NULLIF(split_part(name, '/', 2), '')::uuid
      AND c.user_id = auth.uid() AND c.status = 'active'
  )
);

CREATE POLICY tutor_attachments_delete ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'tutor_attachments' AND split_part(name, '/', 1) = auth.uid()::text
);

