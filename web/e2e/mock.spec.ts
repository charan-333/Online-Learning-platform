import { expect, test } from '@playwright/test';
import { finishOnboardingSkippingDiagnostic, registerLearner } from './helpers';

test('sample mock: answer, flag, move sections, resume, submit, analysis without percentile', async ({ page }) => {
  await registerLearner(page);
  await finishOnboardingSkippingDiagnostic(page);
  await page.getByRole('link', { name: 'Mocks' }).click();
  await expect(page.getByText(/has not been verified against the official notification/)).toBeVisible();
  const row = page.locator('li', { hasText: 'Sample test in CAT format' });
  await row.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/mocks\/run\//);
  await expect(page.getByText(/Section 1 of 3: VARC/)).toBeVisible();
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
