import { expect, test } from '@playwright/test';
import { login, monitorPage, state } from './helpers';

test.setTimeout(90_000);

test('authenticated core UI is localized to Arabic and remains RTL', async ({ page }, testInfo) => {
  const assertClean = monitorPage(page, testInfo);
  const s = state();

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('تسجيل الدخول')).toBeVisible();
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeVisible();

  await login(page, s.users.adminA.email, s.password);
  await expect(page.getByTestId('nav-dashboard').first()).toContainText('لوحة التحكم');
  await expect(page.getByTestId('nav-questionbank').first()).toContainText('بنك الأسئلة');
  await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();

  await page.getByTestId('nav-questionbank').first().click();
  await expect(page.getByRole('heading', { name: 'بنك الأسئلة' }).first()).toBeVisible();
  await expect(page.getByPlaceholder('ابحث في نص السؤال...')).toBeVisible();

  await page.getByRole('button', { name: /إضافة سؤال/i }).click();
  await expect(page.getByRole('heading', { name: 'إضافة سؤال' })).toBeVisible();
  await page.getByTestId('question-prompt').fill(`اختبار تعريب ${Date.now()}`);
  await expect(page.getByTestId('question-subject-select')).not.toHaveValue('');
  await page.getByTestId('remove-option').nth(1).click();
  await page.getByTestId('save-question').click();
  await expect(page.getByTestId('question-editor-error')).toContainText('لا يمكن ترك الاختيارات فارغة.');
  await page.getByRole('button', { name: 'إلغاء' }).click();

  await page.getByPlaceholder('ابحث في نص السؤال...').fill(`localization missing ${Date.now()}`);
  await expect(page.getByText('لا توجد أسئلة مطابقة')).toBeVisible();

  await page.getByPlaceholder('ابحث في نص السؤال...').fill(`E2E MCQ ${s.run}`);
  await expect(page.getByText(`E2E MCQ ${s.run}`).first()).toBeVisible({ timeout: 20_000 });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('هل تريد حذف هذا السؤال؟');
    await dialog.dismiss();
  });
  await page.getByTitle('حذف').first().click();

  for (const pageCheck of [
    { id: 'exambuilder', heading: 'منشئ الاختبارات', forbidden: ['Exam Builder', 'Quick Exam', 'Create Quick Exam'] },
    { id: 'grading', heading: 'التصحيح', forbidden: ['Grading', 'Needs Review', 'Student Answer', 'Model Answer'] },
    { id: 'sis', heading: 'نظام معلومات الطلاب', forbidden: ['Student Information System', 'Students', 'Teachers'] },
  ]) {
    await page.getByTestId(`nav-${pageCheck.id}`).first().click();
    await expect(page.getByRole('heading', { name: pageCheck.heading }).first()).toBeVisible({ timeout: 20_000 });
    for (const forbidden of pageCheck.forbidden) {
      await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
    }
  }

  for (const forbidden of [
    'Question Bank',
    'New question',
    'No questions found',
    'Save changes',
    'Create question',
    'Search question text',
  ]) {
    await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
  }

  await assertClean();
});
