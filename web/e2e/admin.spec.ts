import { expect, test } from '@playwright/test';
import { loginAdmin, registerLearner } from './helpers';

test('learners cannot open the admin console', async ({ page }) => {
  await registerLearner(page);
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/);
});

test('admin validates an import and rejects a PYQ without provenance', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/import');
  const items = [
    { kind: 'question', externalId: 'e2e-bad-pyq', section: 'QA', topic: 'qa-percentages', type: 'TITA', difficulty: 'easy', stem: 'E2E fixture: what is 10% of 70?', answer: '7', estimatedTimeSec: 30, origin: 'authentic_pyq', examYear: 2022, solution: { learn: '0.1 × 70 = 7' } },
    { kind: 'question', externalId: 'e2e-ok', section: 'QA', topic: 'qa-percentages', type: 'TITA', difficulty: 'easy', stem: 'E2E fixture: what is 30% of 70?', answer: '21', estimatedTimeSec: 30, origin: 'original_practice', solution: { learn: '0.3 × 70 = 21', hints: ['Move the decimal'], verification: '21/70 = 0.3' } },
  ];
  await page.getByLabel('Or paste JSON').fill(JSON.stringify({ items }));
  await page.getByRole('button', { name: 'Validate (dry run)' }).click();
  await expect(page.getByText('1 of 2 item(s) would be accepted; 1 rejected.')).toBeVisible();
  await expect(page.getByText('missing_provenance')).toBeVisible();

  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText('Authentic PYQs')).toBeVisible();
  await page.getByRole('link', { name: 'Exam pattern' }).click();
  await expect(page.getByLabel('Verification')).toHaveValue('unverified');
});
