import { expect, test } from '@playwright/test';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test.describe('Institutions management', () => {
  test.setTimeout(90_000);

  test('super_admin creates, finds, edits, disables an institution and creates a branch', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const suffix = Date.now().toString(36);
    const institutionName = `مؤسسة اختبار ${suffix}`;
    const editedName = `مؤسسة اختبار محدثة ${suffix}`;
    const branchName = `فرع اختبار ${suffix}`;

    await login(page, s.users.superAdmin.email, s.password);
    await page.getByTestId('nav-institutions').click();
    await expect(page.getByTestId('institution-add')).toBeVisible();

    await page.getByTestId('institution-add').click();
    await page.getByTestId('institution-name').fill(institutionName);
    await page.getByTestId('institution-save').click();
    await expect(page.getByTestId('institution-name')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('institutions-loading')).toHaveCount(0, { timeout: 15_000 });

    await page.getByTestId('institution-search').fill(institutionName);
    await expect(page.getByText(institutionName)).toBeVisible();

    const createdId = psqlScalar(`select id from public.institutions where name = ${sqlValue(institutionName)} limit 1;`);
    await page.getByTestId(`institution-edit-${createdId}`).click();
    await page.getByTestId('institution-name').fill(editedName);
    await page.getByTestId('institution-save').click();
    await page.getByTestId('institution-search').fill(editedName);
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`institution-row-${createdId}`).click();
    await page.getByTestId('branch-add').click();
    await page.getByTestId('branch-name').fill(branchName);
    await page.getByTestId('branch-save').click();
    await expect(page.getByText(branchName)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`institution-toggle-${createdId}`).click();
    await expect(page.getByText('تم تعطيل المؤسسة.')).toBeVisible();
    expect(psqlScalar(`select is_active::text from public.institutions where id = ${sqlValue(createdId)}::uuid;`)).toBe('false');

    psqlScalar(`delete from public.institutions where id = ${sqlValue(createdId)}::uuid returning 'ok';`);
    await assertClean();
  });

  test('non-super roles cannot use the institutions page directly', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();

    await login(page, s.users.teacherA.email, s.password);
    await expect(page.getByTestId('nav-institutions')).toHaveCount(0);
    await page.goto('/?view=institutions');
    await expect(page.getByTestId('nav-dashboard')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('institution-add')).toHaveCount(0);

    await logout(page);
    await login(page, s.users.dataEntryA.email, s.password);
    await expect(page.getByTestId('nav-institutions')).toHaveCount(0);
    await page.goto('/?view=institutions');
    await expect(page.getByTestId('nav-dashboard')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('institution-add')).toHaveCount(0);

    await assertClean();
  });
});
