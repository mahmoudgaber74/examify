import { expect, test, type Page } from '@playwright/test';
import { login, monitorPage, state } from './helpers';

async function openView(page: Page, id: string) {
  const nav = page.getByTestId(`nav-${id}`).first();
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await nav.click();
}

async function closeTopModal(page: Page) {
  const modal = page.locator('.fixed.inset-0').last();
  await expect(modal).toBeVisible();
  await modal.locator('button').first().evaluate((button) => (button as HTMLButtonElement).click());
  await expect(modal).toHaveCount(0);
}

test.describe('CRUD smoke checks', () => {
  test.setTimeout(60_000);

  test('admin CRUD entry points open real editor surfaces', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    await login(page, s.users.adminA.email, s.password);

    await openView(page, 'sis');
    await page.getByTestId('sis-tab-structure').click();
    await page.getByTestId('structure-add-grade').click();
    await expect(page.getByTestId('structure-save')).toBeVisible();
    await closeTopModal(page);

    await openView(page, 'questionbank');
    await page.getByRole('button', { name: /إضافة سؤال/ }).click();
    await expect(page.getByTestId('question-prompt')).toBeVisible();
    await page.getByRole('button', { name: 'إلغاء' }).click();

    await openView(page, 'exambuilder');
    await page.getByTestId('exam-add').click();
    await closeTopModal(page);

    await page.getByTestId('quick-exam-open').click();
    await closeTopModal(page);

    await assertClean();
  });

  test('student account cannot see administrative CRUD pages', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    await login(page, s.users.studentA.email, s.password);

    await expect(page.getByTestId('nav-examrunner')).toBeVisible();
    await expect(page.getByTestId('nav-sis')).toHaveCount(0);
    await expect(page.getByTestId('nav-questionbank')).toHaveCount(0);
    await expect(page.getByTestId('nav-exambuilder')).toHaveCount(0);
    await expect(page.getByTestId('nav-grading')).toHaveCount(0);

    await assertClean();
  });
});
