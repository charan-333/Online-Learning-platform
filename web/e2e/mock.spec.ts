import { expect, test } from '@playwright/test';
import { finishOnboardingSkippingDiagnostic, registerLearner } from './helpers';

test('sample mock: answer, flag, move sections, resume, submit, analysis without percentile', async ({ page }) => {
  await registerLearner(page);
  await finishOnboardingSkippingDiagnostic(page);
  await page.getByRole('link', { name: 'Mocks' }).click();
  const banner = page.getByTestId('pattern-banner');
  await expect(banner).toContainText('New tests follow CAT 2024 pattern (version 1), which is not verified against an official source.');
  await expect(banner).toContainText('Treat the timing and marking as provisional');
  const row = page.locator('li', { hasText: 'Sample test in CAT format' });
  await row.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/mocks\/run\//);
  await expect(page.getByText(/Section 1 of 3: VARC/)).toBeVisible();
  await expect(page.getByTestId('run-pattern')).toHaveText('Timing and marking: CAT 2024 pattern (version 1, unverified)');
  await expect(page.getByRole('timer')).toBeVisible();

  await page.getByRole('radiogroup', { name: 'Answer options' }).getByRole('radio').first().check();
  await page.getByRole('button', { name: /Flag for review/ }).click();
  await expect(page.getByRole('button', { name: /Question 1, answered, flagged/ })).toBeVisible();

  // resume after reload keeps the saved answer
  await page.reload();
  await expect(page.getByRole('button', { name: /Question 1, answered, flagged/ })).toBeVisible();

  await page.getByRole('button', { name: 'Next section' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText(/Section 2 of 3: DILR/)).toBeVisible();

  await page.getByRole('button', { name: 'Submit test' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await expect(page).toHaveURL(/\/mocks\/analysis\//);
  await expect(page.getByText(/No percentile estimate is shown/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Every question' })).toBeVisible();
});
