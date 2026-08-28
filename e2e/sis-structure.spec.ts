import { expect, test } from '@playwright/test';
import { login, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function fillStructureName(page: import('@playwright/test').Page, name: string) {
  const modal = page.locator('.fixed.inset-0').last();
  await expect(modal).toBeVisible();
  await modal.locator('input').first().fill(name);
}

test.describe('SIS academic structure', () => {
  test.setTimeout(90_000);

  test('school_admin creates branch, grade, class and section with real relationships', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const suffix = Date.now().toString(36);
    const branchName = `فرع SIS ${suffix}`;
    const gradeName = `صف SIS ${suffix}`;
    const className = `فصل SIS ${suffix}`;
    const sectionName = `شعبة SIS ${suffix}`;

    await login(page, s.users.adminA.email, s.password);
    await page.getByTestId('nav-sis').click();
    await page.getByTestId('sis-tab-structure').click();

    await page.getByTestId('structure-add-branch').click();
    await fillStructureName(page, branchName);
    await page.getByTestId('structure-save').click();
    await expect(page.getByText(branchName)).toBeVisible({ timeout: 15_000 });
    const branchId = psqlScalar(`select id from public.branches where name = ${sqlValue(branchName)} limit 1;`);

    await page.getByTestId('structure-add-grade').click();
    await fillStructureName(page, gradeName);
    await page.getByTestId('structure-save').click();
    await expect(page.getByText(gradeName)).toBeVisible({ timeout: 15_000 });
    const gradeId = psqlScalar(`select id from public.grade_levels where name = ${sqlValue(gradeName)} limit 1;`);

    await page.getByTestId('structure-add-class').click();
    await fillStructureName(page, className);
    const classModal = page.locator('.fixed.inset-0').last();
    await classModal.locator('select').nth(0).selectOption(branchId);
    await classModal.locator('select').nth(1).selectOption(gradeId);
    await page.getByTestId('structure-save').click();
    await expect(page.getByText(className)).toBeVisible({ timeout: 15_000 });
    const classId = psqlScalar(`select id from public.classes where name = ${sqlValue(className)} limit 1;`);

    await page.getByTestId('structure-add-section').click();
    await fillStructureName(page, sectionName);
    const sectionModal = page.locator('.fixed.inset-0').last();
    await sectionModal.locator('select').first().selectOption(classId);
    await page.getByTestId('structure-save').click();
    await expect(page.getByText(sectionName)).toBeVisible({ timeout: 15_000 });

    expect(psqlScalar(`select count(*) from public.classes where id = ${sqlValue(classId)}::uuid and institution_id = ${sqlValue(s.ids.instA)}::uuid and grade_level_id = ${sqlValue(gradeId)}::uuid and branch_id = ${sqlValue(branchId)}::uuid;`)).toBe('1');
    expect(psqlScalar(`select count(*) from public.sections where class_id = ${sqlValue(classId)}::uuid and name = ${sqlValue(sectionName)};`)).toBe('1');

    psqlScalar(`delete from public.classes where id = ${sqlValue(classId)}::uuid returning 'ok';`);
    psqlScalar(`delete from public.branches where id = ${sqlValue(branchId)}::uuid returning 'ok';`);
    psqlScalar(`delete from public.grade_levels where id = ${sqlValue(gradeId)}::uuid returning 'ok';`);
    await assertClean();
  });

  test('data_entry cannot open structure or subject management tabs', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    await login(page, s.users.dataEntryA.email, s.password);
    await page.getByTestId('nav-sis').click();
    await expect(page.getByTestId('sis-tab-structure')).toHaveCount(0);
    await expect(page.getByTestId('sis-tab-subjects')).toHaveCount(0);
    await assertClean();
  });
});
