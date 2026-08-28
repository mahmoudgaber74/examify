import { expect, test, type Page } from '@playwright/test';
import { login, monitorPage, psqlScalar, state } from './helpers';

test.describe.serial('Question bank', () => {
  test.setTimeout(60_000);

  async function openQuestionBank(page: Page) {
    const s = state();
    await login(page, s.users.adminA.email, s.password);
    await page.getByTestId('nav-questionbank').first().click();
    await expect(page.getByRole('heading', { name: 'بنك الأسئلة' }).first()).toBeVisible();
  }

  async function fillMcq(page: Page, prompt: string, first = 'Alpha', second = 'Beta') {
    await page.getByTestId('question-prompt').fill(prompt);
    await page.getByTestId('option-label').nth(0).fill(first);
    await page.getByTestId('option-label').nth(1).fill(second);
  }

  async function saveQuestion(page: Page, modalTitle: 'إضافة سؤال' | 'تعديل السؤال') {
    const questionModal = page.getByRole('heading', { name: modalTitle });
    const editorError = page.getByTestId('question-editor-error');
    const rpcErrors: string[] = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/rpc/save_multiple_choice_question') || response.status() < 400) return;
      rpcErrors.push(`${response.status()} ${await response.text().catch(() => '')}`);
    });
    await expect(page.getByTestId('question-subject-select')).not.toHaveValue('');
    await page.getByTestId('save-question').click();

    let result: 'saved' | 'error';
    try {
      result = await Promise.race([
        questionModal.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => 'saved' as const),
        editorError.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'error' as const),
      ]);
    } catch {
      await page.screenshot({ path: `test-results/question-save-timeout-${Date.now()}.png`, fullPage: true });
      const errorText = await editorError.textContent().catch(() => '');
      throw new Error(`Question save timed out.${errorText ? ` Last editor error: ${errorText}` : ''}`);
    }

    if (result === 'error') {
      const errorText = (await editorError.textContent())?.trim() || 'Unknown editor error.';
      await page.screenshot({ path: `test-results/question-save-error-${Date.now()}.png`, fullPage: true });
      throw new Error(`Question save failed: ${errorText}${rpcErrors.length ? ` | RPC: ${rpcErrors.join(' | ')}` : ''}`);
    }
  }

  async function createValidMcq(page: Page, prompt: string, first = 'Alpha', second = 'Beta') {
    await page.getByRole('button', { name: /إضافة سؤال/i }).click();
    await fillMcq(page, prompt, first, second);
    await saveQuestion(page, 'إضافة سؤال');
    await page.getByPlaceholder('ابحث في نص السؤال...').fill(prompt);
    await expect(page.getByText(prompt).first()).toBeVisible({ timeout: 20_000 });
  }

  async function searchQuestion(page: Page, prompt: string) {
    await page.getByPlaceholder('ابحث في نص السؤال...').fill(prompt);
    await expect(page.getByText(prompt).first()).toBeVisible({ timeout: 20_000 });
  }

  test.afterAll(() => {
    psqlScalar(`
      delete from public.questions
      where prompt like 'QB E2E %';
    `);
  });

  test('renders seeded questions and supports core read-only interactions', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();

    await openQuestionBank(page);
    await expect(page.getByText(`E2E MCQ ${s.run}`).first()).toBeVisible({ timeout: 20_000 });

    await page.getByPlaceholder('ابحث في نص السؤال...').fill(`E2E MCQ ${s.run}`);
    await expect(page.getByText(`E2E MCQ ${s.run}`).first()).toBeVisible();

    await page.getByPlaceholder('ابحث في نص السؤال...').fill(`missing question ${s.run}`);
    await expect(page.getByText('لا توجد أسئلة مطابقة')).toBeVisible();

    await page.getByPlaceholder('ابحث في نص السؤال...').fill('');
    await page.getByTitle('معاينة').first().click();
    await expect(page.getByRole('heading', { name: 'معاينة السؤال' })).toBeVisible();
    await page.locator('.fixed.inset-0 button').first().click();
    await expect(page.getByRole('heading', { name: 'معاينة السؤال' })).toHaveCount(0);

    await assertClean();
  });

  test('creates a valid MCQ and shows options with correct answers in admin preview', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const prompt = `QB E2E create ${Date.now()}`;

    await openQuestionBank(page);
    await createValidMcq(page, prompt, 'Correct option', 'Wrong option');

    await page.getByTitle('معاينة').first().click();
    await expect(page.getByRole('heading', { name: 'معاينة السؤال' })).toBeVisible();
    await expect(page.getByTestId('preview-option')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByText('Correct option')).toBeVisible();
    await expect(page.getByText('Wrong option')).toBeVisible();
    await expect(page.getByTestId('preview-correct-option')).toContainText('صحيحة');

    await assertClean();
  });

  test('validates invalid MCQ creation without writing partial data', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const oneOptionPrompt = `QB E2E one option ${Date.now()}`;
    const noCorrectPrompt = `QB E2E no correct ${Date.now()}`;

    await openQuestionBank(page);
    await page.getByRole('button', { name: /إضافة سؤال/i }).click();
    await page.getByTestId('question-prompt').fill(oneOptionPrompt);
    await page.getByTestId('option-label').nth(0).fill('Only option');
    await page.getByTestId('remove-option').nth(1).click();
    await expect(page.getByTestId('question-subject-select')).not.toHaveValue('');
    await page.getByTestId('save-question').click();
    await expect(page.getByText('أضف اختيارين على الأقل.')).toBeVisible();
    expect(Number(psqlScalar(`select count(*) from public.questions where prompt = '${oneOptionPrompt.replaceAll("'", "''")}';`))).toBe(0);
    await page.getByRole('button', { name: 'إلغاء' }).click();

    await page.getByRole('button', { name: /إضافة سؤال/i }).click();
    await fillMcq(page, noCorrectPrompt, 'A', 'B');
    await page.getByTestId('option-correct').nth(0).uncheck();
    await expect(page.getByTestId('question-subject-select')).not.toHaveValue('');
    await page.getByTestId('save-question').click();
    await expect(page.getByText('حدّد إجابة صحيحة واحدة على الأقل.')).toBeVisible();
    expect(Number(psqlScalar(`select count(*) from public.questions where prompt = '${noCorrectPrompt.replaceAll("'", "''")}';`))).toBe(0);

    await assertClean();
  });

  test('edits an existing MCQ and preserves old options after invalid edits', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const prompt = `QB E2E edit ${Date.now()}`;
    const editedPrompt = `${prompt} updated`;

    await openQuestionBank(page);
    await createValidMcq(page, prompt, 'Old correct', 'Old wrong');
    await searchQuestion(page, prompt);
    await page.getByTitle('تعديل').first().click();
    await page.getByTestId('question-prompt').fill(editedPrompt);
    await page.getByTestId('option-label').nth(0).fill('New wrong');
    await page.getByTestId('option-label').nth(1).fill('New correct');
    await page.getByTestId('option-correct').nth(0).uncheck();
    await page.getByTestId('option-correct').nth(1).check();
    await saveQuestion(page, 'تعديل السؤال');
    await searchQuestion(page, editedPrompt);

    const labelsAfterValidEdit = psqlScalar(`
      select string_agg(o.label || ':' || o.is_correct::text, ',' order by o.sort_order)
      from public.questions q
      join public.question_options o on o.question_id = q.id
      where q.prompt = '${editedPrompt.replaceAll("'", "''")}';
    `);
    expect(labelsAfterValidEdit).toBe('New wrong:false,New correct:true');

    await page.getByTitle('تعديل').first().click();
    await page.getByTestId('option-label').nth(0).fill(' ');
    await page.getByTestId('save-question').click();
    await expect(page.getByText('لا يمكن ترك الاختيارات فارغة.')).toBeVisible();

    const labelsAfterInvalidEdit = psqlScalar(`
      select string_agg(o.label || ':' || o.is_correct::text, ',' order by o.sort_order)
      from public.questions q
      join public.question_options o on o.question_id = q.id
      where q.prompt = '${editedPrompt.replaceAll("'", "''")}';
    `);
    expect(labelsAfterInvalidEdit).toBe('New wrong:false,New correct:true');

    await assertClean();
  });

  test('deletes a question after confirmation', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const prompt = `QB E2E delete ${Date.now()}`;

    await openQuestionBank(page);
    await createValidMcq(page, prompt, 'Delete correct', 'Delete wrong');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTitle('حذف').first().click();
    await expect(page.getByText('لا توجد أسئلة مطابقة')).toBeVisible({ timeout: 20_000 });
    expect(Number(psqlScalar(`select count(*) from public.questions where prompt = '${prompt.replaceAll("'", "''")}';`))).toBe(0);

    await assertClean();
  });

  test('advanced types are enabled and expose their editors', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);

    await openQuestionBank(page);
    await page.getByTestId('question-add').click();

    await page.getByTestId('question-type-select').selectOption('fill_blank');
    await expect(page.getByTestId('fill-blank-row')).toHaveCount(1);

    await page.getByTestId('question-type-select').selectOption('matching');
    await expect(page.getByTestId('matching-pair-row')).toHaveCount(2);

    await page.getByTestId('question-type-select').selectOption('ordering');
    await expect(page.getByTestId('ordering-item-row')).toHaveCount(2);

    await assertClean();
  });
});
