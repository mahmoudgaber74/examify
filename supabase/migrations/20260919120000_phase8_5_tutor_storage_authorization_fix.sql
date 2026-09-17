-- Phase 8.5: evaluate Tutor attachment authorization without cross-schema RLS failures.
-- This helper returns only an authorization boolean and never exposes conversation data.

CREATE OR REPLACE FUNCTION public.can_access_tutor_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tutor_conversations c
    WHERE c.id = p_conversation_id
      AND (
        c.user_id = auth.uid()
        OR (
          public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
          AND (
            public.current_user_role() = 'super_admin'
            OR c.institution_id = public.current_user_institution_id()
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_tutor_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_tutor_conversation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_upload_tutor_attachment(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tutor_conversations c
    WHERE c.id = p_conversation_id
      AND c.user_id = auth.uid()
      AND c.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.can_upload_tutor_attachment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_upload_tutor_attachment(uuid) TO authenticated;

DROP POLICY IF EXISTS tutor_attachments_select ON storage.objects;
DROP POLICY IF EXISTS tutor_attachments_insert ON storage.objects;

CREATE POLICY tutor_attachments_select ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'tutor_attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
  OR (
    bucket_id = 'tutor_attachments'
    AND public.can_access_tutor_conversation(NULLIF(split_part(name, '/', 2), '')::uuid)
  )
);

CREATE POLICY tutor_attachments_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'tutor_attachments'
  AND split_part(name, '/', 1) = auth.uid()::text
  AND public.can_upload_tutor_attachment(NULLIF(split_part(name, '/', 2), '')::uuid)
);
