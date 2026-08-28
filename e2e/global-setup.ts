import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

type LocalStatus = {
  API_URL?: string;
  ANON_KEY?: string;
  SERVICE_ROLE_KEY?: string;
  service_role_key?: string;
};

const statePath = resolve('test-results/e2e-state.json');

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql: string) {
  execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function localStatus(): Required<Pick<LocalStatus, 'API_URL' | 'ANON_KEY'>> & { SERVICE_ROLE_KEY: string } {
  const raw = execFileSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const status = JSON.parse(raw) as LocalStatus;
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.service_role_key;
  if (!status.API_URL || !status.ANON_KEY || !serviceRoleKey) {
    throw new Error('Supabase local status did not return API_URL, ANON_KEY, and SERVICE_ROLE_KEY.');
  }
  return { API_URL: status.API_URL, ANON_KEY: status.ANON_KEY, SERVICE_ROLE_KEY: serviceRoleKey };
}

async function createAuthUser(admin: ReturnType<typeof createClient>, label: string, password: string) {
  const email = `${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}@e2e.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? `Failed to create ${label}`);
  return { id: data.user.id, email };
}

export default async function globalSetup() {
  const status = localStatus();
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const run = Date.now().toString(36);
  const password = `E2e-${randomUUID()}-Aa1!`;
  const ids = {
    instA: randomUUID(),
    instB: randomUUID(),
    academicYearA: randomUUID(),
    gradeA: randomUUID(),
    classA: randomUUID(),
    sectionA: randomUUID(),
    studentAProfile: randomUUID(),
    studentBProfile: randomUUID(),
    parentAProfile: randomUUID(),
    subjectA: randomUUID(),
    questionA: randomUUID(),
    optionA: randomUUID(),
    optionB: randomUUID(),
    examA: randomUUID(),
    bubbleSheetA: randomUUID(),
  };

  const users = {
    superAdmin: await createAuthUser(admin, 'super-admin', password),
    adminA: await createAuthUser(admin, 'school-admin-a', password),
    teacherA: await createAuthUser(admin, 'teacher-a', password),
    graderA: await createAuthUser(admin, 'grader-a', password),
    dataEntryA: await createAuthUser(admin, 'data-entry-a', password),
    studentA: await createAuthUser(admin, 'student-a', password),
    studentB: await createAuthUser(admin, 'student-b', password),
    parentA: await createAuthUser(admin, 'parent-a', password),
    adminB: await createAuthUser(admin, 'school-admin-b', password),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`E2E Institution A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`E2E Institution B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.superAdmin.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Super Admin ${run}`)}, 'super_admin', true),
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`School Admin A ${run}`)}, 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Teacher A ${run}`)}, 'teacher', true),
      (${sqlValue(users.graderA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Grader A ${run}`)}, 'grader', true),
      (${sqlValue(users.dataEntryA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Data Entry A ${run}`)}, 'data_entry', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`School Admin B ${run}`)}, 'school_admin', true);

    insert into public.academic_years (id, institution_id, name, start_date, end_date, is_current, is_active)
    values (${sqlValue(ids.academicYearA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`E2E Year ${run}`)}, current_date - interval '30 days', current_date + interval '300 days', true, true);

    insert into public.grade_levels (id, institution_id, name, sort_order)
    values (${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`E2E Grade ${run}`)}, 1);

    insert into public.classes (id, institution_id, grade_level_id, academic_year_id, academic_year, name, is_active)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.academicYearA)}::uuid, ${sqlValue(`E2E Year ${run}`)}, ${sqlValue(`E2E Class ${run}`)}, true);

    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`E2E Section ${run}`)}, true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active, status)
    values
      (${sqlValue(ids.studentAProfile)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`E2E-A-${run}`)}, ${sqlValue(`E2E Student A ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentBProfile)}::uuid, ${sqlValue(users.studentB.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`E2E-B-${run}`)}, ${sqlValue(`E2E Student B ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active');

    insert into public.class_students (class_id, section_id, student_id)
    values
      (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid),
      (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentBProfile)}::uuid);

    insert into public.parent_profiles (id, user_id, institution_id, full_name, phone, is_active)
    values (${sqlValue(ids.parentAProfile)}::uuid, ${sqlValue(users.parentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Parent A ${run}`)}, '0500000000', true);

    insert into public.parent_student_links (parent_id, student_id, relationship, can_view_grades, can_view_attendance, can_receive_alerts)
    values (${sqlValue(ids.parentAProfile)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid, 'ولي أمر', true, true, true);

    insert into public.subjects (id, institution_id, name, name_en, code, is_active)
    values (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`E2E Subject ${run}`)}, 'E2E Subject', ${sqlValue(`E2E_${run}`)}, true);

    insert into public.grade_subjects (institution_id, academic_year_id, grade_level_id, subject_id, class_id, is_active)
    values (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.academicYearA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, true);

    insert into public.subject_teachers (subject_id, class_id, teacher_id, academic_year_id, grade_level_id, section_id, is_active)
    select ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, sp.id, ${sqlValue(ids.academicYearA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, true
    from public.staff_profiles sp
    where sp.user_id = ${sqlValue(users.teacherA.id)}::uuid;

    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values (${sqlValue(ids.questionA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', ${sqlValue(`E2E MCQ ${run}`)}, 'easy', 1, '{}'::jsonb);

    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values
      (${sqlValue(ids.optionA)}::uuid, ${sqlValue(ids.questionA)}::uuid, 'A', true, 0),
      (${sqlValue(ids.optionB)}::uuid, ${sqlValue(ids.questionA)}::uuid, 'B', false, 1);

    insert into public.examify_exams (
      id, institution_id, subject_id, class_id, title, description, total_points,
      passing_score, duration_minutes, max_attempts, shuffle_questions, shuffle_options,
      show_result_immediately, show_correct_answers, status
    )
    values (
      ${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid,
      ${sqlValue(`E2E Exam ${run}`)}, 'Created by E2E setup', 1, 50, 30, 1, false, false, false, true, 'published'
    );

    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.questionA)}::uuid, 1, 0);

    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.classA)}::uuid);

    insert into public.bubble_sheets (id, institution_id, exam_id, model_label, questions_count, choices_count, include_student_id, include_student_name, include_qr)
    values (${sqlValue(ids.bubbleSheetA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.examA)}::uuid, 'A', 1, 4, true, true, true);
  `);

  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    run,
    supabaseUrl: status.API_URL,
    anonKey: status.ANON_KEY,
    password,
    ids,
    users,
  }, null, 2));
}
