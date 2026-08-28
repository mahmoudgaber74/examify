import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function openQuestionBank(page: Page) {
  const s = state();
  await login(page, s.users.adminA.email, s.password);
  await page.getByTestId('nav-questionbank').first().click();
  await expect(page.getByTestId('question-add')).toBeVisible({ timeout: 20_000 });
}

async function saveEditor(page: Page) {
  const rpcErrors: string[] = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/rpc/save_advanced_question') || response.status() < 400) return;
    rpcErrors.push(`${response.status()} ${await response.text().catch(() => '')}`);
  });
  await page.getByTestId('save-question').click();
  const editorError = page.getByTestId('question-editor-error');
  const result = await Promise.race([
    page.getByTestId('save-question').waitFor({ state: 'hidden', timeout: 20_000 }).then(() => 'saved' as const),
    editorError.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'error' as const),
  ]);
  if (result === 'error') {
    throw new Error(`${(await editorError.textContent())?.trim() ?? 'Question save failed'}${rpcErrors.length ? ` | ${rpcErrors.join(' | ')}` : ''}`);
  }
}

async function createFillBlank(page: Page, prompt: string) {
  const s = state();
  await page.getByTestId('question-add').click();
  await page.getByTestId('question-type-select').selectOption('fill_blank');
  await page.getByTestId('question-subject-select').selectOption(s.ids.subjectA);
  await page.getByTestId('question-prompt').fill(prompt);
  await page.getByTestId('fill-blank-answers').first().fill('القاهرة\ncairo');
  await page.getByTestId('add-fill-blank').click();
  await page.getByTestId('fill-blank-answers').nth(1).fill('النيل');
  await saveEditor(page);
}

async function createMatching(page: Page, prompt: string) {
  const s = state();
  await page.getByTestId('question-add').click();
  await page.getByTestId('question-type-select').selectOption('matching');
  await page.getByTestId('question-subject-select').selectOption(s.ids.subjectA);
  await page.getByTestId('question-prompt').fill(prompt);
  await page.getByTestId('matching-left-text').nth(0).fill('مصر');
  await page.getByTestId('matching-right-text').nth(0).fill('القاهرة');
  await page.getByTestId('matching-left-text').nth(1).fill('السعودية');
  await page.getByTestId('matching-right-text').nth(1).fill('الرياض');
  await saveEditor(page);
}

async function createOrdering(page: Page, prompt: string) {
  const s = state();
  await page.getByTestId('question-add').click();
  await page.getByTestId('question-type-select').selectOption('ordering');
  await page.getByTestId('question-subject-select').selectOption(s.ids.subjectA);
  await page.getByTestId('question-prompt').fill(prompt);
  await page.getByTestId('ordering-item-label').nth(0).fill('افتح الملف');
  await page.getByTestId('ordering-item-label').nth(1).fill('اقرأ السؤال');
  await page.getByTestId('add-ordering-item').click();
  await page.getByTestId('ordering-item-label').nth(2).fill('اكتب الإجابة');
  await saveEditor(page);
}

function questionIdFor(prompt: string) {
  return psqlScalar(`select id from public.questions where prompt = ${sqlValue(prompt)} limit 1;`);
}

function createPublishedExam(title: string, questionIds: string[]) {
  const s = state();
  const examId = randomUUID();
  psqlScalar(`
    insert into public.examify_exams (
      id, institution_id, subject_id, class_id, title, total_points,
      passing_score, duration_minutes, max_attempts, shuffle_questions, shuffle_options,
      show_result_immediately, show_correct_answers, status
    )
    values (${sqlValue(examId)}::uuid, ${sqlValue(s.ids.instA)}::uuid, ${sqlValue(s.ids.subjectA)}::uuid, ${sqlValue(s.ids.classA)}::uuid, ${sqlValue(title)}, 6, 50, 30, 1, false, false, true, true, 'published');

    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(examId)}::uuid, ${sqlValue(s.ids.classA)}::uuid);

    ${questionIds.map((questionId, index) => `
      insert into public.exam_questions (exam_id, question_id, points, sort_order)
      values (${sqlValue(examId)}::uuid, ${sqlValue(questionId)}::uuid, 2, ${index});
    `).join('\n')}
  `);
  return examId;
}

test.describe.serial('Advanced question types', () => {
  test.setTimeout(120_000);

  const suffix = Date.now().toString(36);
  const prompts = {
    fill: `AQT fill ${suffix}`,
    matching: `AQT matching ${suffix}`,
    ordering: `AQT ordering ${suffix}`,
  };
  const examTitle = `AQT Exam ${suffix}`;

  test.afterAll(() => {
    psqlScalar(`
      delete from public.examify_exams where title = ${sqlValue(examTitle)};
      delete from public.questions where prompt in (${sqlValue(prompts.fill)}, ${sqlValue(prompts.matching)}, ${sqlValue(prompts.ordering)});
    `);
  });

  test('creates, previews, solves, resumes, submits, and auto-grades fill_blank matching ordering', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);

    await openQuestionBank(page);
    await createFillBlank(page, prompts.fill);
    await createMatching(page, prompts.matching);
    await createOrdering(page, prompts.ordering);

    for (const prompt of Object.values(prompts)) {
      await page.getByTestId('question-search').fill(prompt);
      await expect(page.getByText(prompt).first()).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('question-preview').first().click();
      await expect(page.locator('[data-testid^="preview-"]').first()).toBeVisible({ timeout: 10_000 });
      await page.locator('.fixed.inset-0 button').first().click();
      await expect(page.locator('.fixed.inset-0')).toHaveCount(0);
    }

    const questionIds = [questionIdFor(prompts.fill), questionIdFor(prompts.matching), questionIdFor(prompts.ordering)];
    const examId = createPublishedExam(examTitle, questionIds);

    await logout(page);
    const s = state();
    await login(page, s.users.studentA.email, s.password);
    await page.getByTestId('nav-examrunner').first().click();
    await expect(page.getByText(examTitle)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('exam-start').first().click();

    await page.getByTestId('exam-fill-blank-blank_1').fill('  القاهرة ');
    await page.getByTestId('exam-fill-blank-blank_2').fill('النيل');
    await page.getByTestId('exam-next-question').click();

    await page.getByTestId('exam-matching-left_1').selectOption('right_1');
    await page.getByTestId('exam-matching-left_2').selectOption('right_2');
    await page.getByTestId('exam-next-question').click();

    const orderLabels = await page.getByTestId('exam-ordering-item').allTextContents();
    const desired = ['افتح الملف', 'اقرأ السؤال', 'اكتب الإجابة'];
    for (let target = 0; target < desired.length; target += 1) {
      for (let guard = 0; guard < 5; guard += 1) {
        const rows = await page.getByTestId('exam-ordering-item').allTextContents();
        const currentIndex = rows.findIndex((text) => text.includes(desired[target]));
        if (currentIndex === target) break;
        await page.getByTestId('exam-order-up').nth(currentIndex).click();
      }
    }
    expect(orderLabels.length).toBe(3);

    await page.getByTestId('exam-prev-question').click();
    await expect(page.getByTestId('exam-matching-left_1')).toHaveValue('right_1');
    await page.getByTestId('exam-next-question').click();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('exam-submit').click();
    await expect(page.getByTestId('exam-result-percentage')).toContainText('100.0%', { timeout: 20_000 });
    await expect(page.getByTestId('exam-result-score')).toContainText('6.00 / 6');

    const storedPayloads = Number(psqlScalar(`select count(*) from public.answers a join public.exam_attempts ea on ea.id = a.attempt_id where ea.exam_id = ${sqlValue(examId)}::uuid and a.answer_payload is not null;`));
    expect(storedPayloads).toBe(3);

    await assertClean();
  });
});
