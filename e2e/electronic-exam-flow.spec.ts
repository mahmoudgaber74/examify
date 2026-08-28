import { expect, test, type Page } from '@playwright/test';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function openView(page: Page, testId: string) {
  await page.getByTestId(testId).first().click();
}

async function createQuestion(page: Page, type: string, prompt: string, options?: { correct: string; wrong: string }) {
  await openView(page, 'nav-questionbank');
  await page.getByTestId('question-add').click();
  await page.getByTestId('question-type-select').selectOption(type);
  await page.getByTestId('question-prompt').fill(prompt);

  if (type === 'multiple_choice' && options) {
    await page.getByTestId('option-label').nth(0).fill(options.correct);
    await page.getByTestId('option-label').nth(1).fill(options.wrong);
    await page.getByTestId('option-correct').nth(0).check();
    await page.getByTestId('option-correct').nth(1).uncheck();
  }

  await page.getByTestId('save-question').scrollIntoViewIfNeeded();
  await page.getByTestId('save-question').evaluate((button: HTMLElement) => button.click());
  await expect.poll(() => psqlScalar(`select count(*) from public.questions where prompt = ${sqlValue(prompt)};`), { timeout: 20_000 }).toBe('1');
  await expect(page.getByRole('heading', { name: /Ø¥Ø¶Ø§ÙØ© Ø³Ø¤Ø§Ù„|إضافة سؤال/ })).toHaveCount(0, { timeout: 20_000 });
  await page.getByTestId('question-search').fill(prompt);
  await expect(page.getByText(prompt).first()).toBeVisible({ timeout: 20_000 });
}

async function addBankQuestionToExam(page: Page, prompt: string) {
  await page.getByTestId('exam-question-search').fill(prompt);
  const row = page.getByText(prompt, { exact: true }).locator('..');
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByTestId('exam-bank-add-question').first().click();
  await expect(page.getByText(prompt).first()).toBeVisible({ timeout: 20_000 });
}

async function createPublishedExam(page: Page, title: string, mcqPrompt: string, essayPrompt: string) {
  await openView(page, 'nav-exambuilder');
  await page.getByTestId('exam-add').click();
  await page.getByTestId('exam-title').fill(title);
  await page.getByTestId('exam-subject').selectOption({ index: 1 });
  await page.getByTestId('exam-class').selectOption({ index: 1 });
  await page.getByTestId('exam-section').selectOption({ index: 1 });
  await page.getByTestId('exam-status').selectOption('published');
  await page.getByTestId('exam-save-details').click();

  await addBankQuestionToExam(page, mcqPrompt);
  await addBankQuestionToExam(page, essayPrompt);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('exam-assign-class').click();
  await page.getByTestId('exam-editor-done').click();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
}

test.describe.serial('Electronic exam E2E', () => {
  test.setTimeout(120_000);

  test.afterAll(() => {
    psqlScalar(`
      delete from public.parent_notifications where data->>'exam_id' in (select id::text from public.examify_exams where title like 'Electronic E2E %');
      delete from public.grade_book where assessment_title like 'Electronic E2E %';
      delete from public.examify_exams where title like 'Electronic E2E %';
      delete from public.questions where prompt like 'Electronic E2E %';
    `);
  });

  test('teacher creates, assigns, publishes, student submits, teacher grades, student and parent see result', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo, [/\/rest\/v1\/question_options/i]);
    const s = state();
    const suffix = Date.now().toString(36);
    const mcqPrompt = `Electronic E2E MCQ ${suffix}`;
    const essayPrompt = `Electronic E2E Essay ${suffix}`;
    const examTitle = `Electronic E2E Exam ${suffix}`;

    await login(page, s.users.teacherA.email, s.password);
    await createQuestion(page, 'multiple_choice', mcqPrompt, { correct: 'Correct E2E option', wrong: 'Wrong E2E option' });
    await createQuestion(page, 'essay', essayPrompt);
    await createPublishedExam(page, examTitle, mcqPrompt, essayPrompt);
    await logout(page);

    const examId = psqlScalar(`select id from public.examify_exams where title = ${sqlValue(examTitle)} limit 1;`);
    expect(examId).toMatch(/[0-9a-f-]{36}/);
    expect(psqlScalar(`select count(*) from public.exams where title = ${sqlValue(examTitle)};`)).toBe('0');
    expect(psqlScalar(`select count(*) from public.exam_questions where exam_id = ${sqlValue(examId)}::uuid;`)).toBe('2');
    expect(psqlScalar(`select count(*) from public.exam_assignments where exam_id = ${sqlValue(examId)}::uuid and class_id is not null;`)).toBe('1');
    const legacySubmissionsBefore = psqlScalar('select count(*) from public.submissions;');

    await login(page, s.users.studentA.email, s.password);
    await openView(page, 'nav-examrunner');
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    const examCard = page.locator('.card').filter({ hasText: examTitle }).first();
    await expect(examCard).toBeVisible({ timeout: 20_000 });
    await examCard.getByTestId('exam-start').click();
    await expect(page.getByText(mcqPrompt).or(page.getByText(essayPrompt))).toBeVisible({ timeout: 20_000 });

    if (await page.getByText(mcqPrompt).isVisible().catch(() => false)) {
      await page.getByText('Correct E2E option').click();
      await page.getByTestId('exam-next-question').click();
      await page.locator('textarea').fill('Manual essay answer for the electronic exam acceptance test.');
    } else {
      await page.locator('textarea').fill('Manual essay answer for the electronic exam acceptance test.');
      await page.getByTestId('exam-next-question').click();
      await page.getByText('Correct E2E option').click();
    }

    await page.reload();
    await expect(page.getByText('Correct E2E option').or(page.locator('textarea'))).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('exam-submit').click();
    await expect(page.getByText(/ØªØ­ØªØ§Ø¬|مراجعة|review/i)).toBeVisible({ timeout: 20_000 });
    await logout(page);

    const attemptId = psqlScalar(`select id from public.exam_attempts where exam_id = ${sqlValue(examId)}::uuid and student_id = ${sqlValue(s.ids.studentAProfile)}::uuid order by created_at desc limit 1;`);
    expect(attemptId).toMatch(/[0-9a-f-]{36}/);
    expect(psqlScalar(`select status || '|' || score::text || '|' || is_result_published::text from public.exam_attempts where id = ${sqlValue(attemptId)}::uuid;`)).toBe('submitted|1.00|false');
    expect(psqlScalar(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptId)}::uuid and is_correct is null and awarded_points is null;`)).toBe('1');
    expect(psqlScalar('select count(*) from public.submissions;')).toBe(legacySubmissionsBefore);
    expect(psqlScalar(`select count(*) from public.grade_book where attempt_id = ${sqlValue(attemptId)}::uuid;`)).toBe('0');

    await login(page, s.users.teacherA.email, s.password);
    await openView(page, 'nav-grading');
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    await page.getByText(examTitle).first().click();
    await page.getByTestId('grading-edit-score').click();
    await page.getByTestId('grading-score-input').fill('3');
    await page.getByTestId('grading-save-score').click();
    await expect.poll(() => psqlScalar(`select status || '|' || score::text from public.exam_attempts where id = ${sqlValue(attemptId)}::uuid;`)).toBe('graded|3.00');
    await page.getByTestId('grading-publish-result').click();
    await expect.poll(() => psqlScalar(`select status || '|' || is_result_published::text from public.exam_attempts where id = ${sqlValue(attemptId)}::uuid;`)).toBe('approved|true');
    await logout(page);

    expect(psqlScalar(`select score::text || '/' || max_score::text from public.grade_book where attempt_id = ${sqlValue(attemptId)}::uuid;`)).toBe('3.00/100.00');
    expect(Number(psqlScalar(`select count(*) from public.parent_notifications where data->>'attempt_id' = ${sqlValue(attemptId)};`))).toBeGreaterThanOrEqual(1);

    await login(page, s.users.studentA.email, s.password);
    await openView(page, 'nav-examresults');
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/3\.0%|3%/).first()).toBeVisible({ timeout: 20_000 });
    await logout(page);

    await login(page, s.users.parentA.email, s.password);
    await openView(page, 'nav-parents');
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/3\.00\/100\.00|3\/100/).first()).toBeVisible({ timeout: 20_000 });
    await logout(page);

    await login(page, s.users.teacherA.email, s.password);
    await openView(page, 'nav-reports');
    await page.getByTestId('reports-filter-exam').selectOption(examId);
    await expect(page.getByTestId('reports-total-attempts')).toContainText('1', { timeout: 20_000 });
    await page.getByTestId('reports-export-excel').click();
    await page.getByTestId('reports-export-pdf').click();

    await assertClean();
  });
});
