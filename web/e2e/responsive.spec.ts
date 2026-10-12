import { expect, test } from '@playwright/test';
import { finishOnboardingSkippingDiagnostic, registerLearner } from './helpers';

test('mobile layout: menu opens navigation and pages do not scroll sideways', async ({ page }) => {
  await registerLearner(page);
  await finishOnboardingSkippingDiagnostic(page);
  for (const path of ['/', '/questions', '/syllabus', '/plan', '/mocks']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Error log' }).click();
  await expect(page.getByRole('heading', { name: 'Error log' })).toBeVisible();
});
