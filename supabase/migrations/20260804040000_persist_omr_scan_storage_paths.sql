-- Persist OMR scan images in private Supabase Storage and bind paths to exams.
-- Uses the Supabase Storage API policies only; no direct storage.objects access.

ALTER TABLE public.omr_results
  ADD COLUMN IF NOT EXISTS original_storage_path text,
  ADD COLUMN IF NOT EXISTS processed_storage_path text,
  ADD COLUMN IF NOT EXISTS image_mime_type text,
  ADD COLUMN IF NOT EXISTS image_size_bytes integer,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_omr_results_original_storage_path
  ON public.omr_results(original_storage_path)
  WHERE original_storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_omr_results_uploaded_by
  ON public.omr_results(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.omr_storage_path_exam_id(object_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.storage_path_uuid_segment(object_name, 4);
$$;

CREATE OR REPLACE FUNCTION public.omr_storage_path_is_valid(bucket text, object_name text, required_kind text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.storage_path_is_clean(bucket, object_name)
    AND bucket = 'exam-sheets'
    AND public.storage_path_kind(object_name) IN ('omr-original', 'omr-processed')
    AND (required_kind IS NULL OR public.storage_path_kind(object_name) = required_kind)
    AND public.omr_storage_path_exam_id(object_name) IS NOT NULL
    AND object_name NOT ILIKE '%2e%2e%'
    AND object_name NOT LIKE '%\%'
    AND array_length(public.storage_path_segments(object_name), 1) >= 5;
$$;

CREATE OR REPLACE FUNCTION public.omr_storage_path_matches_exam(
  institution uuid,
  exam uuid,
  uploader uuid,
  object_name text,
  required_kind text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT public.omr_storage_path_is_valid('exam-sheets', object_name, required_kind)
    AND public.storage_path_institution_id(object_name) = institution
    AND public.omr_storage_path_exam_id(object_name) = exam
    AND (uploader IS NULL OR public.storage_path_owner_user_id(object_name) = uploader)
    AND EXISTS (
      SELECT 1
      FROM public.examify_exams e
      WHERE e.id = exam
        AND e.institution_id = institution
    );
$$;

CREATE OR REPLACE FUNCTION public.omr_storage_user_can_read(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH path AS (
    SELECT
      public.storage_path_institution_id(object_name) AS institution_id,
      public.storage_path_owner_user_id(object_name) AS owner_user_id,
      public.omr_storage_path_exam_id(object_name) AS exam_id
  )
  SELECT public.omr_storage_path_is_valid(bucket, object_name)
    AND public.storage_is_same_institution((SELECT institution_id FROM path))
    AND public.storage_owner_is_known_institution_user((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
    AND EXISTS (
      SELECT 1
      FROM public.examify_exams e
      WHERE e.id = (SELECT exam_id FROM path)
        AND e.institution_id = (SELECT institution_id FROM path)
    )
    AND (
      public.is_super_admin()
      OR public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'grader', 'data_entry'])
    );
$$;

CREATE OR REPLACE FUNCTION public.omr_storage_user_can_insert(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH path AS (
    SELECT
      public.storage_path_institution_id(object_name) AS institution_id,
      public.storage_path_owner_user_id(object_name) AS owner_user_id,
      public.omr_storage_path_exam_id(object_name) AS exam_id
  )
  SELECT public.omr_storage_path_is_valid(bucket, object_name)
    AND public.storage_is_same_institution((SELECT institution_id FROM path))
    AND public.storage_owner_is_known_institution_user((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
    AND EXISTS (
      SELECT 1
      FROM public.examify_exams e
      WHERE e.id = (SELECT exam_id FROM path)
        AND e.institution_id = (SELECT institution_id FROM path)
    )
    AND (
      public.is_super_admin()
      OR public.storage_role_is_any(ARRAY['school_admin', 'teacher', 'grader'])
    )
    AND (
      public.current_user_role() = 'school_admin'
      OR (SELECT owner_user_id FROM path) = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.omr_storage_user_can_delete(bucket text, object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH path AS (
    SELECT public.storage_path_owner_user_id(object_name) AS owner_user_id
  )
  SELECT public.omr_storage_user_can_read(bucket, object_name)
    AND (
      public.is_super_admin()
      OR public.current_user_role() = 'school_admin'
      OR (
        public.current_user_role() IN ('teacher', 'grader')
        AND (SELECT owner_user_id FROM path) = auth.uid()
      )
    );
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
  SELECT CASE
    WHEN bucket = 'exam-sheets' AND (SELECT kind FROM path) IN ('omr-original', 'omr-processed')
      THEN public.omr_storage_user_can_read(bucket, object_name)
    ELSE public.storage_path_is_clean(bucket, object_name)
      AND public.storage_is_same_institution((SELECT institution_id FROM path))
      AND public.storage_owner_is_known_institution_user((SELECT institution_id FROM path), (SELECT owner_user_id FROM path))
      AND (
        public.is_super_admin()
        OR (
          bucket IN ('institution-documents')
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
      )
    END;
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
  SELECT CASE
    WHEN bucket = 'exam-sheets' AND (SELECT kind FROM path) IN ('omr-original', 'omr-processed')
      THEN public.omr_storage_user_can_insert(bucket, object_name)
    ELSE public.storage_path_is_clean(bucket, object_name)
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
      )
    END;
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
      public.storage_path_kind(object_name) AS kind,
      public.storage_path_owner_user_id(object_name) AS owner_user_id
  )
  SELECT CASE
    WHEN bucket = 'exam-sheets' AND (SELECT kind FROM path) IN ('omr-original', 'omr-processed')
      THEN public.omr_storage_user_can_delete(bucket, object_name)
    ELSE public.storage_path_is_clean(bucket, object_name)
      AND public.storage_is_same_institution((SELECT institution_id FROM path))
      AND (
        public.is_super_admin()
        OR (
          public.current_user_role() = 'school_admin'
          AND bucket IN (
            'avatars', 'student-files', 'question-assets',
            'lms-content', 'certificates', 'institution-documents', 'public-assets'
          )
        )
        OR (
          bucket = 'avatars'
          AND (SELECT owner_user_id FROM path) = auth.uid()
        )
      )
    END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_omr_result_storage_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.uploaded_by IS NULL THEN
    NEW.uploaded_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
      OR NEW.exam_id IS DISTINCT FROM OLD.exam_id THEN
      RAISE EXCEPTION 'omr_result_identity_immutable';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.examify_exams e
    WHERE e.id = NEW.exam_id
      AND e.institution_id = NEW.institution_id
  ) THEN
    RAISE EXCEPTION 'omr_result_exam_institution_mismatch';
  END IF;

  IF NEW.original_storage_path IS NOT NULL
    AND NOT public.omr_storage_path_matches_exam(NEW.institution_id, NEW.exam_id, NEW.uploaded_by, NEW.original_storage_path, 'omr-original') THEN
    RAISE EXCEPTION 'invalid_omr_original_storage_path';
  END IF;

  IF NEW.processed_storage_path IS NOT NULL
    AND NOT public.omr_storage_path_matches_exam(NEW.institution_id, NEW.exam_id, NEW.uploaded_by, NEW.processed_storage_path, 'omr-processed') THEN
    RAISE EXCEPTION 'invalid_omr_processed_storage_path';
  END IF;

  IF NEW.image_url IS NOT NULL AND NEW.image_url LIKE 'blob:%' THEN
    RAISE EXCEPTION 'blob_urls_are_not_persistent_omr_storage';
  END IF;

  IF NEW.image_mime_type IS NOT NULL
    AND NEW.image_mime_type NOT IN ('image/png', 'image/jpeg', 'image/webp') THEN
    RAISE EXCEPTION 'invalid_omr_image_mime_type';
  END IF;

  IF NEW.image_size_bytes IS NOT NULL
    AND (NEW.image_size_bytes <= 0 OR NEW.image_size_bytes > 20971520) THEN
    RAISE EXCEPTION 'invalid_omr_image_size';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_omr_result_storage_integrity ON public.omr_results;
CREATE TRIGGER trg_enforce_omr_result_storage_integrity
BEFORE INSERT OR UPDATE ON public.omr_results
FOR EACH ROW
EXECUTE FUNCTION public.enforce_omr_result_storage_integrity();

DROP POLICY IF EXISTS "omr_results_select" ON public.omr_results;
CREATE POLICY "omr_results_select" ON public.omr_results FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader', 'data_entry')
    )
  );

DROP POLICY IF EXISTS "omr_results_insert" ON public.omr_results;
CREATE POLICY "omr_results_insert" ON public.omr_results FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
    AND (uploaded_by IS NULL OR uploaded_by = auth.uid() OR public.current_user_role() = 'school_admin')
    AND EXISTS (
      SELECT 1
      FROM public.examify_exams e
      WHERE e.id = exam_id
        AND e.institution_id = institution_id
    )
  );

DROP POLICY IF EXISTS "omr_results_update" ON public.omr_results;
CREATE POLICY "omr_results_update" ON public.omr_results FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
    AND EXISTS (
      SELECT 1
      FROM public.examify_exams e
      WHERE e.id = exam_id
        AND e.institution_id = institution_id
    )
  );

DROP POLICY IF EXISTS "omr_results_delete" ON public.omr_results;
CREATE POLICY "omr_results_delete" ON public.omr_results FOR DELETE
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      institution_id = public.current_user_institution_id()
      AND (
        public.current_user_role() = 'school_admin'
        OR (
          public.current_user_role() IN ('teacher', 'grader')
          AND uploaded_by = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "omr_answers_select" ON public.omr_answers;
CREATE POLICY "omr_answers_select" ON public.omr_answers FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.omr_results r
      WHERE r.id = omr_answers.omr_result_id
        AND (
          public.current_user_role() = 'super_admin'
          OR (
            r.institution_id = public.current_user_institution_id()
            AND public.current_user_role() IN ('school_admin', 'teacher', 'grader', 'data_entry')
          )
        )
    )
  );

DROP POLICY IF EXISTS "omr_answers_insert" ON public.omr_answers;
CREATE POLICY "omr_answers_insert" ON public.omr_answers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.omr_results r
      WHERE r.id = omr_answers.omr_result_id
        AND (
          public.current_user_role() = 'super_admin'
          OR (
            r.institution_id = public.current_user_institution_id()
            AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
          )
        )
    )
  );

DROP POLICY IF EXISTS "omr_answers_update" ON public.omr_answers;
CREATE POLICY "omr_answers_update" ON public.omr_answers FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.omr_results r
      WHERE r.id = omr_answers.omr_result_id
        AND r.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.omr_results r
      WHERE r.id = omr_answers.omr_result_id
        AND r.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    )
  );

DROP POLICY IF EXISTS "omr_answers_delete" ON public.omr_answers;
CREATE POLICY "omr_answers_delete" ON public.omr_answers FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.omr_results r
      WHERE r.id = omr_answers.omr_result_id
        AND r.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );
