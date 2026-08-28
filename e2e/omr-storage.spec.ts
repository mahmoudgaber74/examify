import { expect, test } from '@playwright/test';
import { login, logout, monitorPage, psqlScalar, state, tinyPng } from './helpers';

test.describe.serial('OMR storage UI flow', () => {
  test.setTimeout(60_000);

  test('uploads OMR scan, persists storage path, and reloads review image from signed URL', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo, [], [/status of 409 \(Conflict\)/]);
    const s = state();
    const previousCount = Number(psqlScalar(`
      select count(*) from public.omr_results
      where exam_id = '${s.ids.examA}' and uploaded_by = '${s.users.teacherA.id}';
    `));
    const scanBuffer = Buffer.concat([tinyPng, Buffer.from(`-${s.run}-${testInfo.workerIndex}-${Date.now()}-storage`)]);

    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-bubblesheet').first().click();
    await page.getByTestId('omr-tab-scan').click();
    await page.locator('select').first().selectOption(s.ids.examA);
    await page.getByTestId('omr-upload-input').setInputFiles({
      name: `scan-${s.run}.png`,
      mimeType: 'image/png',
      buffer: scanBuffer,
    });
    await expect(page.getByText(`scan-${s.run}.png`)).toBeVisible();
    await page.getByTestId('omr-scan-submit').click();

    await expect.poll(() => Number(psqlScalar(`
      select count(*) from public.omr_results
      where exam_id = '${s.ids.examA}' and uploaded_by = '${s.users.teacherA.id}';
    `)), { timeout: 30_000 }).toBeGreaterThan(previousCount);

    const storagePath = psqlScalar(`
      select original_storage_path
      from public.omr_results
      where exam_id = '${s.ids.examA}' and uploaded_by = '${s.users.teacherA.id}'
      order by created_at desc
      limit 1;
    `);
    expect(storagePath).toContain('/omr-original/');
    expect(storagePath).not.toContain('blob:');
    const omrResultId = psqlScalar(`
      select id
      from public.omr_results
      where exam_id = '${s.ids.examA}' and uploaded_by = '${s.users.teacherA.id}'
      order by created_at desc
      limit 1;
    `);
    psqlScalar(`
      insert into public.omr_answers (
        omr_result_id,
        question_number,
        question_id,
        option_id,
        detected_answer,
        correct_answer,
        is_correct,
        confidence,
        needs_manual_review,
        review_reason,
        fill_ratios
      )
      values (
        '${omrResultId}',
        1,
        '${s.ids.questionA}',
        '${s.ids.optionB}',
        'B',
        'A',
        false,
        0.42,
        true,
        'ambiguous',
        '{"A":0.24,"B":0.25}'::jsonb
      )
      on conflict (omr_result_id, question_number) do update set
        question_id = excluded.question_id,
        option_id = excluded.option_id,
        detected_answer = excluded.detected_answer,
        correct_answer = excluded.correct_answer,
        is_correct = excluded.is_correct,
        confidence = excluded.confidence,
        needs_manual_review = excluded.needs_manual_review,
        review_reason = excluded.review_reason,
        fill_ratios = excluded.fill_ratios;

      update public.omr_results
      set status = 'needs_review',
          total_questions = 1,
          correct_count = 0,
          wrong_count = 1,
          empty_count = 0,
          confidence = 0.42,
          review_reasons = '[{"question":1,"reason":"ambiguous"}]'::jsonb
      where id = '${omrResultId}';

      select 'ok';
    `);

    await page.getByTestId('omr-tab-results').click();
    await page.getByTestId('omr-view-result').first().click();
    const image = page.getByTestId('omr-review-image');
    await expect(image).toBeVisible({ timeout: 20_000 });
    await expect(image).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/exam-sheets\//);

    await page.reload();
    await page.getByTestId('nav-bubblesheet').first().click();
    await page.getByTestId('omr-tab-results').click();
    await page.getByTestId('omr-view-result').first().click();
    await expect(page.getByTestId('omr-review-image')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('omr-review-image')).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/exam-sheets\//);

    await page.getByTestId('omr-student-select').selectOption(s.ids.studentBProfile);
    await page.getByTestId('omr-answer-override').first().selectOption('A');
    await page.getByTestId('omr-save-draft').click();
    await expect.poll(() => psqlScalar(`
      select student_profile_id::text
      from public.omr_results
      where exam_id = '${s.ids.examA}' and uploaded_by = '${s.users.teacherA.id}'
      order by created_at desc
      limit 1;
    `), { timeout: 20_000 }).toBe(s.ids.studentBProfile);

    await page.reload();
    await page.getByTestId('nav-bubblesheet').first().click();
    await page.getByTestId('omr-tab-results').click();
    await page.getByTestId('omr-view-result').first().click();
    await expect(page.getByText(/معدّلة|معدلة/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('omr-approve-result').click();
    await expect.poll(() => psqlScalar(`
      select status || ':' || (exam_attempt_id is not null)::text
      from public.omr_results
      where exam_id = '${s.ids.examA}' and student_profile_id = '${s.ids.studentBProfile}'
      order by created_at desc
      limit 1;
    `), { timeout: 20_000 }).toBe('approved:true');

    const attemptId = psqlScalar(`
      select exam_attempt_id
      from public.omr_results
      where exam_id = '${s.ids.examA}' and student_profile_id = '${s.ids.studentBProfile}'
      order by created_at desc
      limit 1;
    `);
    expect(psqlScalar(`select count(*) from public.answers where attempt_id = '${attemptId}';`)).toBe('1');
    expect(psqlScalar(`select is_result_published::text from public.exam_attempts where id = '${attemptId}';`)).toBe('false');

    await page.getByTestId('nav-grading').first().click();
    await page.getByTestId('grading-attempt').first().click();
    await page.getByTestId('grading-publish-result').click();
    await expect.poll(() => psqlScalar(`select is_result_published::text from public.exam_attempts where id = '${attemptId}';`), { timeout: 20_000 }).toBe('true');

    await logout(page);
    await login(page, s.users.studentB.email, s.password);
    await page.getByTestId('nav-examresults').first().click();
    await page.getByTestId('result-view').first().click();
    await expect(page.getByText('100.0%')).toBeVisible({ timeout: 20_000 });
    await assertClean();
  });

  test('rejects unsupported OMR file type before upload', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const previousCount = Number(psqlScalar(`
      select count(*) from public.omr_results
      where exam_id = '${s.ids.examA}' and uploaded_by = '${s.users.teacherA.id}';
    `));

    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-bubblesheet').first().click();
    await page.getByTestId('omr-tab-scan').click();
    await page.locator('select').first().selectOption(s.ids.examA);
    await page.getByTestId('omr-upload-input').setInputFiles({
      name: `bad-${s.run}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('bad scan'),
    });
    await page.getByTestId('omr-scan-submit').click();
    expect(Number(psqlScalar(`
      select count(*) from public.omr_results
      where exam_id = '${s.ids.examA}' and uploaded_by = '${s.users.teacherA.id}';
    `))).toBe(previousCount);
    await assertClean();
  });

  test('student role has no Bubble Sheet navigation entry', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();

    await login(page, s.users.studentA.email, s.password);
    await expect(page.getByTestId('nav-bubblesheet')).toHaveCount(0);
    await logout(page);
    await assertClean();
  });
});
