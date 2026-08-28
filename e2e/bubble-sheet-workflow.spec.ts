import { expect, test } from '@playwright/test';
import { login, logout, monitorPage, psqlScalar, state, tinyPng } from './helpers';

test.describe('Bubble Sheet workflow acceptance', () => {
  test('teacher can create a template with an opaque QR token', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo, [], [/status of 409 \(Conflict\)/]);
    const s = state();
    await login(page, s.users.teacherA.email, s.password);
    await page.getByTestId('nav-bubblesheet').first().click();
    await page.getByTestId('omr-tab-generate').click();
    await page.getByTestId('omr-exam-select').selectOption(s.ids.examA);
    const templateCount = Number(psqlScalar(`
      select count(*) from public.bubble_sheets where exam_id = '${s.ids.examA}';
    `));
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('omr-generate-template').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('bubble-sheet-');
    await expect.poll(() => Number(psqlScalar(`
      select count(*) from public.bubble_sheets
      where exam_id = '${s.ids.examA}' and qr_token is not null and status = 'active';
    `)), { timeout: 20_000 }).toBeGreaterThanOrEqual(templateCount + 1);

    const qr = psqlScalar(`
      select qr_token::text || ':' || (qr_token::text !~ '${s.ids.examA}|${s.ids.studentA}')::text
      from public.bubble_sheets where exam_id = '${s.ids.examA}'
      order by created_at desc limit 1;
    `);
    expect(qr.split(':')[1]).toBe('true');

    await page.getByTestId('omr-tab-scan').click();
    await page.getByTestId('omr-scan-exam-select').selectOption(s.ids.examA);
    await page.getByTestId('omr-upload-input').setInputFiles({ name: `acceptance-${s.run}.png`, mimeType: 'image/png', buffer: tinyPng });
    await expect(page.locator('img[alt="scan preview"]')).toBeVisible();
    await page.getByTestId('omr-scan-submit').click();
    await expect(page.getByText(/نتيجة|Ù†ØªÙŠØ¬Ø©/).first()).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('omr-upload-input').setInputFiles({ name: `acceptance-${s.run}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 local acceptance') });
    await expect(page.locator('iframe[title="PDF preview"]')).toBeVisible();
    await page.getByTestId('omr-scan-submit').click();
    await expect(page.getByText(/PDF uploaded|PDF/).first()).toBeVisible();

    await page.reload();
    await logout(page);
    await login(page, s.users.studentA.email, s.password);
    await expect(page.getByTestId('nav-bubblesheet')).toHaveCount(0);
    await assertClean();
  });
});
