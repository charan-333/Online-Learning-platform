import { expect, test } from '@playwright/test';
import { registerLearner } from './helpers';

test('diagnostic: answer every question, get per-section results and a plan', async ({ page }) => {
  await registerLearner(page);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('link', { name: 'Start the diagnostic' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 40; i++) {
    const radios = page.getByRole('radiogroup', { name: 'Answer options' }).getByRole('radio');
    if (await radios.count()) await radios.first().check();
    else await page.getByLabel('Your answer').fill('1');
    const submit = page.getByRole('button', { name: 'Submit diagnostic' });
    if (await submit.isVisible()) {
      await submit.click();
      break;
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Diagnostic results' })).toBeVisible();
  for (const s of ['QA', 'VARC', 'DILR']) await expect(page.getByRole('heading', { name: s, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'See my plan' }).click();
  await expect(page.getByRole('heading', { name: 'Study plan' })).toBeVisible();
  await expect(page.getByText(/done · \d+ pending/)).toBeVisible();
});
