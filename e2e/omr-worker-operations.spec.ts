import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { login, monitorPage, psqlScalar, state } from './helpers';

test.describe.serial('Durable OMR worker operations', () => {
  test.setTimeout(150_000);

  test('queues a real PDF, persists asynchronously, and exposes a real permanent failure for retry', async ({ page }, testInfo) => {
    const clean = monitorPage(page, testInfo, [/\/functions\/v1\/omr-analyze/]);
    const s = state();
    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-bubblesheet').first().click();
    await page.getByTestId('omr-tab-generate').click();
    await page.getByTestId('omr-exam-select').selectOption(s.ids.examA);
    await page.getByTestId('omr-question-count').fill('1');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('omr-generate-template').click();
    const download = await downloadPromise;
    const pdfPath = await download.path();
    expect(pdfPath).toBeTruthy();
    await page.getByTestId('omr-tab-scan').click();
    await page.getByTestId('omr-engine-select').selectOption('opencv');
    await page.getByTestId('omr-scan-exam-select').selectOption(s.ids.examA);
    await page.getByTestId('omr-upload-input').setInputFiles({ name: `worker-${s.run}.pdf`, mimeType: 'application/pdf', buffer: readFileSync(pdfPath!) });
    await page.getByTestId('omr-scan-submit').click();
    await expect(page.getByTestId('opencv-scan-result')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => Number(psqlScalar("select count(*) from public.omr_processing_jobs where status in ('completed','needs_review');")), { timeout: 90_000 }).toBeGreaterThan(0);
    expect(Number(psqlScalar("select count(*) from public.omr_processing_jobs where status = 'processing' and locked_by is null;"))).toBe(0);

    const invalidPdf = Buffer.from(`%PDF-1.4\nworker-invalid-${s.run}-${Date.now()}`);
    await page.getByTestId('omr-upload-input').setInputFiles({ name: `invalid-${s.run}.pdf`, mimeType: 'application/pdf', buffer: invalidPdf });
    await page.getByTestId('omr-scan-submit').click();
    await expect.poll(() => Number(psqlScalar("select count(*) from public.omr_processing_jobs where status = 'failed' and error_code = 'omr_invalid_input';")), { timeout: 90_000 }).toBeGreaterThan(0);

    await page.getByTestId('nav-omrops').first().click();
    await expect(page.getByRole('heading', { name: 'OMR Operations' })).toBeVisible();
    await page.locator('select').first().selectOption('failed');
    await expect(page.locator('div').filter({ hasText: /^فشل$/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'إعادة' }).first().click();
    await expect.poll(() => Number(psqlScalar("select count(*) from public.omr_processing_jobs where status in ('retrying','failed') and attempt_count >= 1;")), { timeout: 30_000 }).toBeGreaterThan(0);
    await clean();
  });
});
