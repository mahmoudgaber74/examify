# Examify AI — Migration Verification Report

Date: 2026-09-05  
Scope: static migration-chain and effective-policy review for Phase 2A.  
Runtime status: **BLOCKED** — the local Supabase/PostgreSQL instance is unavailable, so no migration was applied or executed here.

## Ordered inventory

The repository contains 57 migration files. Supabase must apply them in filename order; historical files are retained and were not edited or deleted.

```text
20260630221048_create_examify_tables.sql
20260630224143_create_examify_additional_tables.sql
20260702225235_create_parents_notifications_tables.sql
20260728232924_20260728080000_create_examify_core_schema.sql.sql
20260728232956_20260728082000_update_role_system_and_self_registration.sql.sql
20260728233459_20260728090000_create_bubble_sheet_omr_tables.sql.sql
20260728233838_20260728093000_create_ai_ocr_tables.sql.sql
20260728234158_20260728100000_create_lms_sis_parents_tables.sql.sql
20260729010000_harden_self_registration_bootstrap.sql
20260729043000_complete_student_management.sql
20260802090000_secure_rls_and_tenant_isolation.sql
20260804010000_secure_storage_buckets_and_policies.sql
20260804020000_add_subject_code_uniqueness.sql
20260804030000_enforce_canonical_exam_assignment_rls.sql
20260804040000_persist_omr_scan_storage_paths.sql
20260804050000_complete_omr_modern_workflow.sql
20260804060000_complete_academic_structure_management.sql
20260805090000_atomic_question_bank_mcq_save.sql
20260805091000_profile_backed_current_user_role.sql
20260805093000_avoid_question_option_rls_return_scan.sql
20260805100000_atomic_exam_attempt_submission_grading.sql
20260805110000_harden_role_access_rls.sql
20260805120000_complete_institutions_permissions.sql
20260805130000_harden_sis_role_permissions.sql
20260805131000_fix_parent_student_link_policy_recursion.sql
20260805140000_complete_advanced_question_types.sql
20260805141000_fix_advanced_autograding_update.sql
20260805150000_harden_omr_review_workflow.sql
20260805160000_complete_ai_grading_workflow.sql
20260805161000_ai_grading_failure_simulation.sql
20260805162000_fix_ai_essay_word_count.sql
20260805163000_persist_failed_ai_grading_jobs.sql
20260805164000_fix_ai_grading_status_ambiguity.sql
20260811120000_complete_academic_setup.sql
20260811162000_secure_exam_runner_options.sql
20260811163000_sync_published_exam_results_to_grade_book.sql
20260821120000_harden_bubble_sheet_template_metadata.sql
20260821130000_persist_opencv_omr_jobs.sql
20260822090000_durable_omr_worker_operations.sql
20260822130000_harden_teacher_exam_authorization.sql
20260825120000_bootstrap_first_admin_from_pending_staff.sql
20260825130000_secure_user_notifications.sql
20260827090000_composite_bubble_sheet_metadata.sql
20260827100000_institution_settings.sql
20260828090000_allow_public_institution_signup.sql
20260828091000_grant_signup_institution_read.sql
20260828092000_allow_first_admin_availability_check.sql
20260830100000_scope_teacher_data_access.sql
20260904090000_phase1_security_tightening.sql
20260904100000_marketplace_truthful_checkout.sql
20260905110000_phase2_certification_tutor.sql
20260906100000_phase3_legacy_tenant_cleanup.sql
20260907100000_phase4_teacher_approved_ai_grading.sql
20260908100000_phase4_omr_human_review.sql
20260908110000_phase4_exam_item_analysis.sql
20260912100000_phase5_exam_violations.sql
20260913100000_phase6_tutor_attachments.sql
```

## Rewrite and conflict review

- `current_user_role()` and `current_user_institution_id()` are established in the core chain and rewritten by the security and profile-backed migrations.
- `submit_exam_attempt()` is rewritten by the atomic submission migration and then by the advanced-question/autograding fixes. The later filename is the intended definition for a clean replay.
- OMR storage authorization, queue operations, review authorization, notification triggers, certificate issuance/revocation, Tutor session creation, AI grading approval, and OMR review resolution are also introduced or replaced by later migrations.
- The chain contains historical policies and nullable columns from `20260802090000_secure_rls_and_tenant_isolation.sql`. `20260904090000_phase1_security_tightening.sql` removes the anonymous grants and changes key policy predicates to require a non-null tenant. `20260906100000_phase3_legacy_tenant_cleanup.sql` is the intended data/constraint forward migration.
- No historical migration was removed or rewritten. The cleanup migration creates an isolated inactive `System / Legacy` institution, assigns only previously orphaned rows to it, and then sets `NOT NULL`; it does not infer ownership from unrelated tenants.

## Tenant security matrix

| Data area | Tenant ownership in intended final chain | Access control status | Runtime verification |
|---|---|---|---|
| institutions / profiles | institution-backed | role and institution predicates | blocked |
| students / courses / exams | cleanup migration makes institution mandatory | authenticated tenant policies | blocked |
| submissions / certificates | cleanup migration makes institution mandatory | student/teacher/super-admin policies and RPC checks | blocked |
| exam_attempts / answers | institution-scoped through exam and attempt relationships | submission/grading RPCs and RLS | blocked |
| Tutor conversations/messages | conversation owner plus institution | owner/staff policies | blocked |
| OMR results/jobs/answers | institution mandatory | staff authorization and review RPCs | blocked |
| AI grading approval | exam institution checked in SECURITY DEFINER RPCs | teacher/staff only | blocked |
| notifications / parent links | cleanup migration makes institution mandatory | recipient/parent and staff predicates | blocked |
| Storage objects | bucket/path plus institution/session checks | private buckets and signed URLs | blocked |
| marketplace/cart | institution-scoped cart/order records | authenticated owner and tenant predicates | blocked |

## Remaining verification required

Run `supabase db reset` only against a disposable local database, or apply forward migrations to an isolated staging clone after backup. Then inspect `pg_policies`, `pg_proc`, `information_schema.columns`, and orphan counts. Run the security suite with real tenant-A/tenant-B fixtures. Do not reset or rewrite production/staging from this report.

