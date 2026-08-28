import { expect, test } from '@playwright/test';
import { login, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test.describe('SIS students', () => {
  test.setTimeout(90_000);

  test('data_entry creates, edits, suspends and links a student to class, section and parent', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const suffix = Date.now().toString(36);
    const firstName = `SISFirst${suffix}`;
    const fatherName = `SISFather${suffix}`;
    const familyName = `SISFamily${suffix}`;
    const editedFirstName = `SISEdited${suffix}`;
    const studentName = `${firstName} ${fatherName} ${familyName}`;
    const editedName = `${editedFirstName} ${fatherName} ${familyName}`;
    const studentCode = `SIS-${suffix}`;
    const parentName = `SIS Parent ${suffix}`;

    await login(page, s.users.dataEntryA.email, s.password);
    await page.getByTestId('nav-sis').click();
    await expect(page.getByTestId('sis-tab-students')).toBeVisible();
    await expect(page.getByTestId('sis-tab-subjects')).toHaveCount(0);

    await page.getByTestId('student-add').first().click();
    await page.getByTestId('student-first-name').fill(firstName);
    await page.getByTestId('student-father-name').fill(fatherName);
    await page.getByTestId('student-family-name').fill(familyName);
    await expect(page.getByTestId('student-full-name')).toHaveValue(studentName);
    await page.getByTestId('student-code').fill(studentCode);
    await page.getByTestId('student-seat-number').fill(`SEAT-${suffix}`);
    await page.getByTestId('student-email').fill(`student-${suffix}@example.local`);
    await page.getByTestId('student-grade').selectOption(s.ids.gradeA);
    await page.getByTestId('student-class').selectOption(s.ids.classA);
    await page.getByTestId('student-section').selectOption(s.ids.sectionA);
    await page.getByTestId('student-parent-name').fill(parentName);
    await page.getByTestId('student-parent-phone').fill('0500000000');
    await page.getByTestId('student-save').click();
    await expect(page.getByTestId('student-full-name')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(studentName)).toBeVisible({ timeout: 15_000 });

    const studentId = psqlScalar(`select id from public.student_profiles where student_code = ${sqlValue(studentCode)} limit 1;`);
    await page.getByTestId(`student-edit-${studentId}`).click();
    await page.getByTestId('student-first-name').fill(editedFirstName);
    await expect(page.getByTestId('student-full-name')).toHaveValue(editedName);
    await page.getByTestId('student-save').click();
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`student-toggle-${studentId}`).click();
    expect(psqlScalar(`select is_active::text from public.student_profiles where id = ${sqlValue(studentId)}::uuid;`)).toBe('false');

    expect(psqlScalar(`select first_name from public.student_profiles where id = ${sqlValue(studentId)}::uuid;`)).toBe(editedFirstName);
    expect(psqlScalar(`select count(*) from public.class_students where student_id = ${sqlValue(studentId)}::uuid and class_id = ${sqlValue(s.ids.classA)}::uuid and section_id = ${sqlValue(s.ids.sectionA)}::uuid and status = 'active';`)).toBe('1');
    expect(psqlScalar(`select count(*) from public.parent_student_links psl join public.parent_profiles pp on pp.id = psl.parent_id where psl.student_id = ${sqlValue(studentId)}::uuid and pp.full_name = ${sqlValue(parentName)};`)).toBe('1');

    psqlScalar(`delete from public.parent_profiles where full_name = ${sqlValue(parentName)} returning 'ok';`);
    psqlScalar(`delete from public.student_profiles where id = ${sqlValue(studentId)}::uuid returning 'ok';`);
    await assertClean();
  });

  test('teacher has SIS read access without student management actions', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-sis').click();
    await expect(page.getByTestId('sis-tab-students')).toBeVisible();
    await expect(page.getByTestId('student-add')).toHaveCount(0);
    await expect(page.getByTestId('student-add-empty')).toHaveCount(0);
    await expect(page.getByTestId('sis-tab-subjects')).toHaveCount(0);
    await assertClean();
  });
});
