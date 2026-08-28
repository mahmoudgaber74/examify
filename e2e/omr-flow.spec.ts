import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { login, monitorPage, psqlScalar, state, tinyPng } from './helpers';

test.describe.serial('Bubble Sheet / OMR end-to-end flow', () => {
  test.setTimeout(75_000);

  test('creates a printable template, uploads a scan, persists metadata, and blocks duplicate scans', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo, [], [/status of 409 \(Conflict\)/]);
    const s = state();
    const scanNonce = `${s.run}-${testInfo.workerIndex}-${Date.now()}-omr-flow`;
    const scanBuffer = Buffer.concat([tinyPng, Buffer.from(`-${scanNonce}`)]);
    const scanHash = createHash('sha256').update(scanBuffer).digest('hex');

    const templateCountBefore = Number(psqlScalar(`
      select count(*)
      from public.bubble_sheets
      where exam_id = '${s.ids.examA}';
    `));
    const resultCountBefore = Number(psqlScalar(`
      select count(*)
      from public.omr_results
      where exam_id = '${s.ids.examA}'
        and file_sha256 = '${scanHash}';
    `));

    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-bubblesheet').first().click();

    await page.getByTestId('omr-tab-generate').click();
    await page.getByTestId('omr-exam-select').selectOption(s.ids.examA);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('omr-generate-template').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('bubble-sheet-');
    await expect.poll(() => Number(psqlScalar(`
      select count(*)
      from public.bubble_sheets
      where exam_id = '${s.ids.examA}';
    `)), { timeout: 20_000 }).toBeGreaterThan(templateCountBefore);

    await page.getByTestId('omr-tab-scan').click();
    await page.locator('select').first().selectOption(s.ids.examA);
    await page.getByTestId('omr-upload-input').setInputFiles({
      name: `flow-${s.run}.png`,
      mimeType: 'image/png',
      buffer: scanBuffer,
    });
    await page.getByTestId('omr-scan-submit').click();

    await expect.poll(() => Number(psqlScalar(`
      select count(*)
      from public.omr_results
      where exam_id = '${s.ids.examA}'
        and file_sha256 = '${scanHash}';
    `)), { timeout: 30_000 }).toBe(resultCountBefore + 1);

    const metadata = psqlScalar(`
      select file_sha256 || ':' || template_version::text || ':' || (original_storage_path is not null)::text
      from public.omr_results
      where exam_id = '${s.ids.examA}'
        and file_sha256 = '${scanHash}'
      order by created_at desc
      limit 1;
    `);
    expect(metadata).toBe(`${scanHash}:1:true`);

    await page.getByTestId('omr-upload-input').setInputFiles({
      name: `flow-duplicate-${s.run}.png`,
      mimeType: 'image/png',
      buffer: scanBuffer,
    });
    await page.getByTestId('omr-scan-submit').click();
    await expect(page.getByText(/نفس صورة المسح|same scan/i)).toBeVisible({ timeout: 10_000 });
    expect(Number(psqlScalar(`
      select count(*)
      from public.omr_results
      where exam_id = '${s.ids.examA}'
        and file_sha256 = '${scanHash}';
    `))).toBe(resultCountBefore + 1);

    await assertClean();
  });
});
