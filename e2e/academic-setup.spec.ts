import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql: string) {
  return psqlScalar(sql);
}

async function saveAcademicModal(page: import('@playwright/test').Page) {
  await page.getByTestId('academic-save').click();
  await expect(page.getByTestId('academic-save')).toHaveCount(0, { timeout: 15_000 });
}

async function createAcademicYear(page: import('@playwright/test').Page, name: string) {
  await page.getByTestId('academic-tab-years').click();
  await page.getByTestId('academic-add-years').click();
  await page.getByTestId('academic-field-name').fill(name);
  await page.getByTestId('academic-field-start-date').fill('2026-09-01');
  await page.getByTestId('academic-field-end-date').fill('2027-06-30');
  await page.getByTestId('academic-check-current').check();
  await saveAcademicModal(page);
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  return psql(`select id from public.academic_years where name = ${sqlValue(name)} limit 1;`);
}

async function createStage(page: import('@playwright/test').Page, name: string, code: string) {
  await page.getByTestId('academic-tab-stages').click();
  await page.getByTestId('academic-add-stages').click();
  await page.getByTestId('academic-field-name').fill(name);
  await page.getByTestId('academic-field-code').fill(code);
  await saveAcademicModal(page);
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  return psql(`select id from public.education_stages where name = ${sqlValue(name)} limit 1;`);
}

async function createGrade(page: import('@playwright/test').Page, name: string, code: string, stageId: string) {
  await page.getByTestId('academic-tab-grades').click();
  await page.getByTestId('academic-add-grades').click();
  await page.getByTestId('academic-field-name').fill(name);
  await page.getByTestId('academic-field-code').fill(code);
  await page.getByTestId('academic-select-stage').selectOption(stageId);
  await saveAcademicModal(page);
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  return psql(`select id from public.grade_levels where name = ${sqlValue(name)} limit 1;`);
}

async function createClass(page: import('@playwright/test').Page, name: string, yearId: string, gradeId: string) {
  await page.getByTestId('academic-tab-classes').click();
  await page.getByTestId('academic-add-classes').click();
  await page.getByTestId('academic-field-name').fill(name);
  await page.getByTestId('academic-select-year').selectOption(yearId);
  await page.getByTestId('academic-select-grade').selectOption(gradeId);
  await saveAcademicModal(page);
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  return psql(`select id from public.classes where name = ${sqlValue(name)} limit 1;`);
}

async function createSubject(page: import('@playwright/test').Page, name: string, code: string) {
  await page.getByTestId('academic-tab-subjects').click();
  await page.getByTestId('academic-add-subjects').click();
  await page.getByTestId('academic-field-name').fill(name);
  await page.getByTestId('academic-field-code').fill(code);
  await saveAcademicModal(page);
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  return psql(`select id from public.subjects where name = ${sqlValue(name)} limit 1;`);
}

async function assignSubjectToGrade(page: import('@playwright/test').Page, yearId: string, gradeId: string, subjectId: string, subjectName: string) {
  await page.getByTestId('academic-tab-gradeSubjects').click();
  await page.getByTestId('academic-add-gradeSubjects').click();
  await page.getByTestId('academic-select-year').selectOption(yearId);
  await page.getByTestId('academic-select-grade').selectOption(gradeId);
  await page.getByTestId('academic-select-subject').selectOption(subjectId);
  await saveAcademicModal(page);
  await expect(page.getByText(subjectName)).toBeVisible({ timeout: 15_000 });
  return psql(`select id from public.grade_subjects where academic_year_id = ${sqlValue(yearId)}::uuid and grade_level_id = ${sqlValue(gradeId)}::uuid and subject_id = ${sqlValue(subjectId)}::uuid limit 1;`);
}

async function assignTeacher(page: import('@playwright/test').Page, teacherId: string, subjectId: string, classId: string, teacherName: string) {
  await page.getByTestId('academic-tab-teachers').click();
  await page.getByTestId('academic-add-teachers').click();
  await page.getByTestId('academic-select-teacher').selectOption(teacherId);
  await page.getByTestId('academic-select-subject').selectOption(subjectId);
  await page.getByTestId('academic-select-class').selectOption(classId);
  await saveAcademicModal(page);
  await expect(page.getByText(teacherName)).toBeVisible({ timeout: 15_000 });
  return psql(`select id from public.subject_teachers where teacher_id = ${sqlValue(teacherId)}::uuid and subject_id = ${sqlValue(subjectId)}::uuid and class_id = ${sqlValue(classId)}::uuid and is_active = true limit 1;`);
}

test.describe('Academic setup acceptance', () => {
  test.setTimeout(180_000);

  test('academic structure works end-to-end for admin, student, teacher, exam builder and RLS', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo, [/\/rest\/v1\/academic_years/i, /\/rest\/v1\/education_stages/i]);
    const s = state();
    const suffix = Date.now().toString(36);
    const yearName = `Acceptance Year ${suffix}`;
    const stageName = `Acceptance Stage ${suffix}`;
    const gradeName = `Acceptance Grade ${suffix}`;
    const className = `Acceptance Class 1A ${suffix}`;
    const classTwoName = `Acceptance Class 1B ${suffix}`;
    const subjectName = `الرياضيات ${suffix}`;
    const subjectCode = `MATH${suffix}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    const editedStageName = `Acceptance Stage Updated ${suffix}`;
    const studentCode = `ACC-ST-${suffix}`;
    const duplicateCode = studentCode;
    const examTitle = `Acceptance Exam ${suffix}`;
    const teacherName = psql(`select full_name from public.staff_profiles where user_id = ${sqlValue(s.users.teacherA.id)}::uuid limit 1;`);
    const teacherId = psql(`select id from public.staff_profiles where user_id = ${sqlValue(s.users.teacherA.id)}::uuid limit 1;`);

    await login(page, s.users.adminA.email, s.password);
    await page.getByTestId('nav-academicsetup').click();
    await expect(page.getByTestId('academic-setup-page')).toBeVisible();
    await expect(page.getByTestId('academic-add-years')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('academic-search').fill(`no-match-${suffix}`);
    await expect(page.getByTestId('academic-empty')).toBeVisible();
    await page.getByTestId('academic-search').fill('');

    await page.getByTestId('academic-add-years').click();
    await page.getByTestId('academic-field-name').fill('');
    await page.getByTestId('academic-save').click();
    await expect(page.getByTestId('academic-message-error')).toBeVisible();
    await page.getByTestId('academic-cancel').click();

    const yearId = await createAcademicYear(page, yearName);
    expect(psql(`select is_current::text from public.academic_years where id = ${sqlValue(yearId)}::uuid;`)).toBe('true');
    const stageId = await createStage(page, stageName, `STG${suffix}`.toUpperCase().slice(0, 20));
    const gradeId = await createGrade(page, gradeName, `GRD${suffix}`.toUpperCase().slice(0, 20), stageId);
    const classId = await createClass(page, className, yearId, gradeId);
    const classTwoId = await createClass(page, classTwoName, yearId, gradeId);
    const subjectId = await createSubject(page, subjectName, subjectCode);
    const gradeSubjectId = await assignSubjectToGrade(page, yearId, gradeId, subjectId, subjectName);
    const teacherAssignmentId = await assignTeacher(page, teacherId, subjectId, classId, teacherName);

    await page.reload();
    await page.getByTestId('academic-tab-gradeSubjects').click();
    await expect(page.getByText(subjectName)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('academic-tab-teachers').click();
    await expect(page.getByText(teacherName)).toBeVisible();

    await page.getByTestId('academic-tab-stages').click();
    await page.getByTestId(`academic-item-stage-${stageId}-edit`).click();
    await page.getByTestId('academic-field-name').fill(editedStageName);
    await saveAcademicModal(page);
    await expect(page.getByText(editedStageName)).toBeVisible({ timeout: 15_000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`academic-item-stage-${stageId}-toggle`).click();
    await expect.poll(() => psql(`select is_active::text from public.education_stages where id = ${sqlValue(stageId)}::uuid;`)).toBe('false');
    await page.getByTestId(`academic-item-stage-${stageId}-toggle`).click();
    await expect.poll(() => psql(`select is_active::text from public.education_stages where id = ${sqlValue(stageId)}::uuid;`)).toBe('true');

    await page.getByTestId('academic-tab-gradeSubjects').click();
    await page.getByTestId(`academic-item-grade-subject-${gradeSubjectId}-edit`).click();
    await page.getByTestId('academic-select-grade').selectOption(gradeId);
    await expect(page.getByTestId('academic-select-class').locator(`option[value="${classId}"]`)).toHaveCount(1);
    await saveAcademicModal(page);

    await page.getByTestId('nav-sis').click();
    await page.getByTestId('student-add').first().click();
    await page.getByTestId('student-first-name').fill('أحمد');
    await page.getByTestId('student-father-name').fill('محمد');
    await page.getByTestId('student-family-name').fill('علي');
    await expect(page.getByTestId('student-full-name')).toHaveValue('أحمد محمد علي');
    await page.getByTestId('student-code').fill(studentCode);
    await page.getByTestId('student-grade').selectOption(gradeId);
    await page.getByTestId('student-class').selectOption(classId);
    await page.getByTestId('student-save').click();
    await expect(page.getByTestId('student-full-name')).toHaveCount(0, { timeout: 15_000 });
    const studentId = psql(`select id from public.student_profiles where student_code = ${sqlValue(studentCode)} limit 1;`);
    expect(psql(`select first_name || '|' || father_name || '|' || family_name || '|' || full_name from public.student_profiles where id = ${sqlValue(studentId)}::uuid;`)).toBe('أحمد|محمد|علي|أحمد محمد علي');
    expect(psql(`select count(*) from public.class_students where student_id = ${sqlValue(studentId)}::uuid and class_id = ${sqlValue(classId)}::uuid and status = 'active';`)).toBe('1');
    expect(psql(`select count(*) from public.grade_subjects where id = ${sqlValue(gradeSubjectId)}::uuid and grade_level_id = ${sqlValue(gradeId)}::uuid and subject_id = ${sqlValue(subjectId)}::uuid and is_active = true;`)).toBe('1');

    await page.reload();
    await page.getByTestId(`student-edit-${studentId}`).click();
    await expect(page.getByTestId('student-first-name')).toHaveValue('أحمد');
    await expect(page.getByTestId('student-father-name')).toHaveValue('محمد');
    await expect(page.getByTestId('student-family-name')).toHaveValue('علي');
    await expect(page.getByTestId('student-full-name')).toHaveValue('أحمد محمد علي');
    await page.getByTestId('student-class').selectOption(classTwoId);
    await page.getByTestId('student-save').click();
    await expect.poll(() => psql(`select count(*) from public.class_students where student_id = ${sqlValue(studentId)}::uuid and class_id = ${sqlValue(classId)}::uuid and status = 'transferred';`)).toBe('1');
    expect(psql(`select count(*) from public.class_students where student_id = ${sqlValue(studentId)}::uuid and class_id = ${sqlValue(classTwoId)}::uuid and status = 'active';`)).toBe('1');

    await page.getByTestId('student-add').first().click();
    await page.getByTestId('student-first-name').fill('Duplicate');
    await page.getByTestId('student-father-name').fill('Code');
    await page.getByTestId('student-family-name').fill('Student');
    await page.getByTestId('student-code').fill(duplicateCode);
    await page.getByTestId('student-save').click();
    await expect(page.getByTestId('student-full-name')).toBeVisible();
    await expect(page.getByText(/مستخدم|already/i)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');

    await logout(page);
    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-exambuilder').click();
    await page.getByTestId('exam-add').click();
    await expect(page.getByTestId('exam-subject').locator(`option[value="${subjectId}"]`)).toHaveCount(1);
    await expect(page.getByTestId('exam-class').locator(`option[value="${classId}"]`)).toHaveCount(1);
    await expect(page.getByTestId('exam-subject').locator('option', { hasText: /Institution B|Teacher B|Other B/i })).toHaveCount(0);
    await page.getByTestId('exam-title').fill(examTitle);
    await page.getByTestId('exam-class').selectOption(classId);
    await page.getByTestId('exam-subject').selectOption(subjectId);
    await page.getByTestId('exam-status').selectOption('draft');
    await page.getByTestId('exam-save-details').click();
    await expect.poll(() => psql(`select count(*) from public.examify_exams where title = ${sqlValue(examTitle)} and subject_id = ${sqlValue(subjectId)}::uuid and class_id = ${sqlValue(classId)}::uuid;`)).toBe('1');

    await logout(page);
    await login(page, s.users.dataEntryA.email, s.password);
    await expect(page.getByTestId('nav-academicsetup')).toHaveCount(0);
    await page.goto('/?view=academicsetup');
    await expect(page.getByTestId('academic-setup-page')).toHaveCount(0);
    await expect(page.getByTestId('nav-sis')).toBeVisible();

    await logout(page);
    await login(page, s.users.studentA.email, s.password);
    await expect(page.getByTestId('nav-academicsetup')).toHaveCount(0);
    await page.goto('/?view=academicsetup');
    await expect(page.getByTestId('academic-setup-page')).toHaveCount(0);

    const instBYear = psql(`
      insert into public.academic_years (institution_id, name, start_date, end_date, is_current, is_active)
      values (${sqlValue(s.ids.instB)}::uuid, ${sqlValue(`B Year ${suffix}`)}, '2026-09-01', '2027-06-30', true, true)
      returning id;
    `).split(/\r?\n/)[0];
    const adminClient = createClient(s.supabaseUrl, s.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await adminClient.auth.signInWithPassword({ email: s.users.adminA.email, password: s.password });
    const crossTenantRead = await adminClient.from('academic_years').select('id').eq('id', instBYear);
    expect(crossTenantRead.error).toBeNull();
    expect(crossTenantRead.data).toEqual([]);
    const crossTenantWrite = await adminClient.from('academic_years').update({ name: `Cross Tenant ${suffix}` }).eq('id', instBYear).select('id');
    expect(crossTenantWrite.error).toBeNull();
    expect(crossTenantWrite.data).toEqual([]);

    expect(psql(`select count(*) from public.subject_teachers where id = ${sqlValue(teacherAssignmentId)}::uuid and subject_id = ${sqlValue(subjectId)}::uuid and class_id = ${sqlValue(classId)}::uuid and is_active = true;`)).toBe('1');
    await assertClean();
  });
});
