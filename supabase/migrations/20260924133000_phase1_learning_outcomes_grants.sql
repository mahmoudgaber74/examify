-- Phase 1A follow-up: expose the RLS-protected outcome tables to the API role.

GRANT SELECT, INSERT, UPDATE ON public.learning_outcomes TO authenticated;
GRANT SELECT ON public.question_learning_outcomes TO authenticated;
