/* Define the parent/student approval function before the security migration revokes it. */

CREATE OR REPLACE FUNCTION public.approve_parent_student_link(
  p_parent_id uuid,
  p_student_id uuid,
  p_relationship text DEFAULT 'parent'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_caller_institution uuid;
BEGIN
  SELECT role, institution_id INTO v_caller_role, v_caller_institution
  FROM public.staff_profiles
  WHERE user_id = auth.uid() AND is_active = true;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Not authorized to approve parent-student links';
  END IF;

  IF v_caller_role = 'school_admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.parent_profiles WHERE id = p_parent_id AND institution_id = v_caller_institution) THEN
      RAISE EXCEPTION 'Parent not found in your institution';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.student_profiles WHERE id = p_student_id AND institution_id = v_caller_institution) THEN
      RAISE EXCEPTION 'Student not found in your institution';
    END IF;
  END IF;

  INSERT INTO public.parent_student_links (parent_id, student_id, relationship, can_view_grades, can_view_attendance, can_receive_alerts)
  VALUES (p_parent_id, p_student_id, p_relationship, true, true, true)
  ON CONFLICT (parent_id, student_id) DO UPDATE SET
    relationship = p_relationship,
    can_view_grades = true,
    can_view_attendance = true,
    can_receive_alerts = true;

  INSERT INTO public.audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_caller_role, 'approve_parent_link', 'parent_student_link', p_parent_id, jsonb_build_object('student_id', p_student_id, 'relationship', p_relationship));
END;
$$;

REVOKE ALL ON FUNCTION public.approve_parent_student_link(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_parent_student_link(uuid, uuid, text) TO authenticated;
