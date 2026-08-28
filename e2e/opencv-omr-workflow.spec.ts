import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

test.describe('OpenCV OMR end-to-end acceptance', () => {
  test('uses generated PDF through Edge Function, persists review, and blocks student review', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const assertClean = monitorPage(page, testInfo, [/\/functions\/v1\/omr-analyze/]);
    const s = state();
    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-bubblesheet').first().click();

    await page.getByTestId('omr-tab-generate').click();
    await page.getByTestId('omr-exam-select').selectOption(s.ids.examA);
    await page.getByTestId('omr-question-count').fill('1');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('omr-generate-template').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.pdf');
    const generatedPdf = await download.path();
    expect(generatedPdf).toBeTruthy();
    const template = psqlScalar(`select qr_token::text from public.bubble_sheets where exam_id = '${s.ids.examA}' order by created_at desc limit 1;`);
    expect(template).toMatch(/^[0-9a-f-]{36}$/i);
    expect(template).not.toContain(s.ids.examA);

    await page.getByTestId('omr-tab-scan').click();
    await page.getByTestId('omr-engine-select').selectOption('opencv');
    await page.getByTestId('omr-scan-exam-select').selectOption(s.ids.examA);
    await page.getByTestId('omr-upload-input').setInputFiles({ name: `generated-${s.run}.pdf`, mimeType: 'application/pdf', buffer: readFileSync(generatedPdf!) });
    await expect(page.locator('iframe[title="PDF preview"]')).toBeVisible();
    await page.getByTestId('omr-scan-submit').click();
    await expect(page.getByTestId('opencv-scan-result')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('opencv-result-metadata')).toContainText('OpenCV');

    const latestScanId = psqlScalar(`select id from public.omr_results order by created_at desc limit 1;`);
    await expect.poll(() => psqlScalar(`select count(*) from public.omr_processing_jobs where scan_id = '${latestScanId}' and status in ('completed','needs_review');`), { timeout: 20_000 }).toBe('1');
    expect(psqlScalar(`select count(*) from public.omr_results where id = '${latestScanId}' and engine = 'opencv' and annotated_storage_path is not null;`)).toBe('1');
    expect(psqlScalar(`select count(*) from storage.objects where bucket_id = 'exam-sheets' and name = (select annotated_storage_path from public.omr_results where id = '${latestScanId}');`)).toBe('1');
    expect(psqlScalar(`select count(*) from public.omr_answers where omr_result_id = '${latestScanId}';`)).toBe('1');

    await page.getByTestId('omr-tab-results').click();
    await page.getByTestId('omr-view-result').first().click();
    await expect(page.getByTestId('omr-review-image')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('omr-answer-override').first().selectOption('B');
    await expect.poll(() => psqlScalar(`select count(*) from public.omr_answers where omr_result_id = (select id from public.omr_results order by created_at desc limit 1) and manual_override = 'B' and option_id is not null;`), { timeout: 20_000 }).toBe('1');
    await page.reload();
    await page.getByTestId('nav-bubblesheet').first().click();
    await page.getByTestId('omr-tab-results').click();
    await page.getByTestId('omr-view-result').first().click();
    await expect(page.getByText(/معدّلة|manual/i).first()).toBeVisible({ timeout: 20_000 });

    await logout(page);
    await login(page, s.users.studentA.email, s.password);
    await expect(page.getByTestId('nav-bubblesheet')).toHaveCount(0);
    await assertClean();
  });
});
