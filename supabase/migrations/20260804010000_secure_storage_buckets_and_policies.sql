-- Examify AI Storage hardening.
-- This migration intentionally does not change Supabase-managed table owners
-- and does not disable Storage RLS.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', false, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('student-files', 'student-files', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('exam-sheets', 'exam-sheets', false, 20971520, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('question-assets', 'question-assets', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'audio/mpeg', 'audio/wav']),
  ('lms-content', 'lms-content', false, 52428800, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'video/mp4', 'audio/mpeg']),
  ('certificates', 'certificates', false, 5242880, ARRAY['application/pdf', 'image/png', 'image/jpeg']),
  ('institution-documents', 'institution-documents', false, 26214400, ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  ('public-assets', 'public-assets', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

REVOKE ALL ON storage.objects FROM anon;
REVOKE ALL ON storage.buckets FROM anon;

CREATE OR REPLACE FUNCTION public.storage_path_segments(object_name text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT storage.foldername(object_name);
$$;

CREATE OR REPLACE FUNCTION public.storage_path_uuid_segment(object_name text, segment_index integer)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  segments text[];
  value text;
BEGIN
  segments := public.storage_path_segments(object_name);
  value := segments[segment_index];

  IF value IS NULL OR value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  RETURN value::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_path_kind(object_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT (public.storage_path_segments(object_name))[2];
$$;

CREATE OR REPLACE FUNCTION public.storage_path_file_name(object_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT storage.filename(object_name);
$$;

CREATE OR REPLACE FUNCTION public.storage_path_is_clean(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT
    bucket IN (
      'avatars', 'student-files', 'exam-sheets', 'question-assets',
      'lms-content', 'certificates', 'institution-documents', 'public-assets'
    )
    AND object_name IS NOT NULL
    AND object_name NOT LIKE '/%'
    AND object_name NOT LIKE '%//%'
    AND object_name NOT LIKE '%/../%'
    AND object_name NOT LIKE '../%'
    AND object_name NOT LIKE '%/..'
    AND public.storage_path_file_name(object_name) IS NOT NULL
    AND public.storage_path_file_name(object_name) <> ''
    AND array_length(public.storage_path_segments(object_name), 1) >= 3
    AND public.storage_path_uuid_segment(object_name, 1) IS NOT NULL
    AND public.storage_path_uuid_segment(object_name, 3) IS NOT NULL
    AND public.storage_path_kind(object_name) IN (
      'profile-image',
      'student-documents',
      'answer-attachments',
      'omr-original',
      'omr-processed',
      'question-asset',
      'lesson-content',
      'certificate-file',
      'institution-document',
      'site-public'
    )
    AND (
      (bucket = 'avatars' AND public.storage_path_kind(object_name) = 'profile-image')
      OR (bucket = 'student-files' AND public.storage_path_kind(object_name) IN ('profile-image', 'student-documents', 'answer-attachments'))
      OR (bucket = 'exam-sheets' AND public.storage_path_kind(object_name) IN ('omr-original', 'omr-processed'))
      OR (bucket = 'question-assets' AND public.storage_path_kind(object_name) = 'question-asset')
      OR (bucket = 'lms-content' AND public.storage_path_kind(object_name) = 'lesson-content')
      OR (bucket = 'certificates' AND public.storage_path_kind(object_name) = 'certificate-file')
      OR (bucket = 'institution-documents' AND public.storage_path_kind(object_name) = 'institution-document')
      OR (bucket = 'public-assets' AND public.storage_path_kind(object_name) = 'site-public')
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_path_institution_id(object_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.storage_path_uuid_segment(object_name, 1);
$$;

CREATE OR REPLACE FUNCTION public.storage_path_owner_user_id(object_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.storage_path_uuid_segment(object_name, 3);
$$;

CREATE OR REPLACE FUNCTION public.storage_owner_is_known_institution_user(institution uuid, owner_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT owner_user IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.user_id = owner_user
        AND sp.institution_id = institution
        AND sp.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.student_profiles st
      WHERE st.user_id = owner_user
        AND st.institution_id = institution
        AND st.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.parent_profiles pp
      WHERE pp.user_id = owner_user
        AND pp.institution_id = institution
        AND pp.is_active = true
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.storage_owner_is_student(institution uuid, owner_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_profiles st
    WHERE st.user_id = owner_user
      AND st.institution_id = institution
      AND st.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.storage_parent_can_read_student_user(institution uuid, student_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.parent_profiles pp
    JOIN public.parent_student_links psl ON psl.parent_id = pp.id
    JOIN public.student_profiles st ON st.id = psl.student_id
    WHERE pp.user_id = auth.uid()
      AND pp.institution_id = institution
      AND pp.is_active = true
      AND st.user_id = student_user
      AND st.institution_id = institution
      AND st.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.storage_student_is_enrolled_for_lesson_user(institution uuid, student_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_profiles st
    WHERE st.user_id = student_user
      AND st.user_id = auth.uid()
      AND st.institution_id = institution
      AND st.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.storage_is_same_institution(institution uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR (
      institution IS NOT NULL
      AND institution = public.current_user_institution_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_role_is_any(allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() = ANY(allowed_roles);
$$;

CREATE OR REPLACE FUNCTION public.storage_user_can_read(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH path AS (
    SELECT
      public.storage_path_institution_id(object_name) AS institution_id,
      public.storage_path_kind(object_name) AS kind,
      public.storage_path_owner_user_id(object_name) AS owner_user_id
  )
  SELECT public.storage_path_is_clean(bucket, object_name)
    AND public.storage_is_same_institution((SELECT institution_id FROM path))
    AND public.storage_owner_is_known_institution_user((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
    AND (
      public.is_super_admin()
      OR (
        bucket IN ('exam-sheets', 'institution-documents')
        AND public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'grader', 'data_entry'])
      )
      OR (
        bucket IN ('question-assets', 'public-assets')
        AND (
          public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'grader', 'data_entry'])
          OR public.current_user_role() = 'student'
        )
      )
      OR (
        bucket = 'lms-content'
        AND (
          public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'data_entry'])
          OR (
            public.current_user_role() = 'student'
            AND public.storage_student_is_enrolled_for_lesson_user((SELECT institution_id FROM path), auth.uid())
          )
        )
      )
      OR (
        bucket = 'avatars'
        AND (
          public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'grader', 'data_entry'])
          OR (SELECT owner_user_id FROM path) = auth.uid()
          OR public.storage_parent_can_read_student_user((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
        )
      )
      OR (
        bucket IN ('student-files', 'certificates')
        AND (
          public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'grader', 'data_entry'])
          OR (SELECT owner_user_id FROM path) = auth.uid()
          OR public.storage_parent_can_read_student_user((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_user_can_insert(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH path AS (
    SELECT
      public.storage_path_institution_id(object_name) AS institution_id,
      public.storage_path_kind(object_name) AS kind,
      public.storage_path_owner_user_id(object_name) AS owner_user_id
  )
  SELECT public.storage_path_is_clean(bucket, object_name)
    AND public.storage_is_same_institution((SELECT institution_id FROM path))
    AND public.storage_owner_is_known_institution_user((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
    AND (
      public.is_super_admin()
      OR (
        bucket = 'avatars'
        AND (
          (SELECT owner_user_id FROM path) = auth.uid()
          OR public.storage_role_is_any(ARRAY['school_admin'])
        )
      )
      OR (
        bucket = 'student-files'
        AND (
          (
            (SELECT kind FROM path) IN ('student-documents', 'profile-image')
            AND public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'data_entry'])
            AND public.storage_owner_is_student((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
          )
          OR (
            (SELECT kind FROM path) = 'answer-attachments'
            AND public.current_user_role() = 'student'
            AND (SELECT owner_user_id FROM path) = auth.uid()
          )
        )
      )
      OR (
        bucket = 'exam-sheets'
        AND public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'data_entry'])
        AND (
          public.current_user_role() IN ('school_admin', 'data_entry')
          OR (SELECT owner_user_id FROM path) = auth.uid()
        )
      )
      OR (
        bucket IN ('question-assets', 'lms-content', 'public-assets')
        AND public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'data_entry'])
        AND (
          public.current_user_role() IN ('school_admin', 'data_entry')
          OR (SELECT owner_user_id FROM path) = auth.uid()
        )
      )
      OR (
        bucket = 'certificates'
        AND public.storage_role_is_any(ARRAY['school_admin', 'teacher'])
        AND public.storage_owner_is_student((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
      )
      OR (
        bucket = 'institution-documents'
        AND public.storage_role_is_any(ARRAY['school_admin', 'data_entry'])
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_user_can_update(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.storage_user_can_read(bucket, object_name)
    AND public.storage_user_can_insert(bucket, object_name);
$$;

CREATE OR REPLACE FUNCTION public.storage_user_can_delete(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH path AS (
    SELECT
      public.storage_path_institution_id(object_name) AS institution_id,
      public.storage_path_owner_user_id(object_name) AS owner_user_id
  )
  SELECT public.storage_path_is_clean(bucket, object_name)
    AND public.storage_is_same_institution((SELECT institution_id FROM path))
    AND (
      public.is_super_admin()
      OR (
        public.current_user_role() = 'school_admin'
        AND bucket IN (
          'avatars', 'student-files', 'exam-sheets', 'question-assets',
          'lms-content', 'certificates', 'institution-documents', 'public-assets'
        )
      )
      OR (
        bucket = 'avatars'
        AND (SELECT owner_user_id FROM path) = auth.uid()
      )
    );
$$;

DROP POLICY IF EXISTS "examify_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "examify_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "examify_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "examify_storage_delete" ON storage.objects;

CREATE POLICY "examify_storage_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (public.storage_user_can_read(bucket_id, name));

CREATE POLICY "examify_storage_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (public.storage_user_can_insert(bucket_id, name));

CREATE POLICY "examify_storage_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (public.storage_user_can_update(bucket_id, name))
WITH CHECK (public.storage_user_can_update(bucket_id, name));

CREATE POLICY "examify_storage_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (public.storage_user_can_delete(bucket_id, name));
