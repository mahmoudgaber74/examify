import { expect, test } from '@playwright/test';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

test.describe.serial('Examify core exam flow', () => {
  test.setTimeout(60_000);

  test('login rejects invalid credentials and accepts a seeded local admin', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();

    await page.goto('/');
    await page.locator('input[type="email"]').fill(`missing-${s.run}@example.test`);
    await page.locator('input[type="password"]').fill('wrong-password');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('input[type="email"]')).toBeVisible();

    await login(page, s.users.adminA.email, s.password);
    await logout(page);
    await assertClean();
  });

  test('student submits, grader grades and publishes, student opens published result', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const examTitle = `E2E Exam ${s.run}`;

    await login(page, s.users.studentA.email, s.password);
    await page.getByTestId('nav-examrunner').first().click();
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('exam-start').first().click();
    await page.getByTestId('exam-option').first().click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('exam-submit').click();

    await expect.poll(() => psqlScalar(`
      select status
      from public.exam_attempts
      where exam_id = '${s.ids.examA}' and student_id = '${s.ids.studentAProfile}'
      order by created_at desc
      limit 1;
    `), { timeout: 20_000 }).toBe('submitted');

    await logout(page);
    await login(page, s.users.graderA.email, s.password);
    await page.getByTestId('nav-grading').first().click();
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('grading-attempt').first().click();
    await page.getByTestId('grading-edit-score').click();
    await page.getByTestId('grading-score-input').fill('1');
    await page.getByTestId('grading-save-score').click();

    await expect.poll(() => psqlScalar(`
      select status
      from public.exam_attempts
      where exam_id = '${s.ids.examA}' and student_id = '${s.ids.studentAProfile}'
      order by created_at desc
      limit 1;
    `), { timeout: 20_000 }).toBe('graded');

    await expect(page.getByTestId('grading-publish-result')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('grading-publish-result').click();
    await expect.poll(() => psqlScalar(`
      select status || ':' || is_result_published::text
      from public.exam_attempts
      where exam_id = '${s.ids.examA}' and student_id = '${s.ids.studentAProfile}'
      order by created_at desc
      limit 1;
    `), { timeout: 20_000 }).toBe('approved:true');

    await page.waitForLoadState('networkidle');
    await logout(page);
    await login(page, s.users.studentA.email, s.password);
    await page.getByTestId('nav-examresults').first().click();
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('result-view').first().click();
    await expect(page.getByText(examTitle).first()).toBeVisible();
    await expect(page.getByText('100.0%')).toBeVisible();
    await assertClean();
  });

  test('second institution user cannot see the seeded exam attempt', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();

    await login(page, s.users.adminB.email, s.password);
    await page.getByTestId('nav-grading').first().click();
    await expect(page.getByText(`E2E Exam ${s.run}`)).toHaveCount(0);
    await assertClean();
  });
});
