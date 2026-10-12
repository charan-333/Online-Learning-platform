import { expect, test } from '@playwright/test';
import { finishOnboardingSkippingDiagnostic, loginAdmin, registerLearner } from './helpers';

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
  await page.getByLabel('Or paste the file contents').fill(JSON.stringify({ items }));
  await page.getByRole('button', { name: 'Validate (dry run)' }).click();
  await expect(page.getByText('1 of 2 item(s) would be accepted; 1 rejected.')).toBeVisible();
  await expect(page.getByText('missing_provenance')).toBeVisible();

  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText('Verified PYQs')).toBeVisible();
  await page.getByRole('link', { name: 'Exam pattern' }).click();
  await expect(page.getByRole('heading', { name: 'CAT 2024, version 1' })).toBeVisible();
  await expect(page.getByText('Learners see this pattern labelled as unverified.')).toBeVisible();
  await expect(page.getByText('Official', { exact: false }).first()).toBeVisible();
});

// TEST FIXTURE: an invented question, labelled as such, used only in the throwaway e2e database.
const CSV = [
  'record_type,external_id,origin,section,topic,type,difficulty,stem,answer,estimated_time_sec,exam_year,exam_slot,question_number,source_name,source_reference,answer_key_name,answer_key_reference,answer_key_answer,solution_learn,solution_verification',
  'question,e2e-fixture-pyq,authentic_pyq,QA,qa-percentages,TITA,medium,E2E FIXTURE (not a CAT question): what is 15% of 60?,9,60,2022,1,5,Fixture paper (not a real CAT paper),Fixture QA Q5,Fixture key (not a real CAT key),Fixture key QA Q5,9,0.15 × 60 = 9,9 / 60 = 0.15',
].join('\n');

test('a PYQ imported from CSV stays hidden until an admin approves it in review', async ({ page, browser }) => {
  await loginAdmin(page);
  await page.goto('/admin/import');
  await page.getByLabel('Format').selectOption('csv');
  await page.getByLabel('Or paste the file contents').fill(CSV);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('1 of 1 item(s) accepted; 0 rejected.')).toBeVisible();

  const learnerCtx = await browser.newContext();
  const learner = await learnerCtx.newPage();
  await registerLearner(learner);
  await finishOnboardingSkippingDiagnostic(learner);
  await learner.goto('/questions?provenance=verified_pyq');
  await expect(learner.getByText('0 matching question(s)')).toBeVisible();

  await page.getByRole('link', { name: 'PYQ review' }).click();
  const unit = page.locator('section.card', { hasText: 'e2e-fixture-pyq' });
  await expect(unit.getByText('checks pass')).toBeVisible();
  await expect(unit.getByText(/Answer key: Fixture key \(not a real CAT key\)/)).toBeVisible();
  const approve = unit.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeDisabled();
  await unit.getByLabel(/compared the text, options and numbering/).check();
  await unit.getByLabel(/checked the stored answer against the cited answer key/).check();
  await unit.getByLabel(/worked through the solution/).check();
  await approve.click();
  await expect(page.getByText('Nothing is waiting for review.')).toBeVisible();

  await learner.reload();
  await expect(learner.getByText('1 matching question(s)')).toBeVisible();
  await expect(learner.getByText('Verified PYQ · CAT 2022 · Slot 1 · Q5')).toBeVisible();
  await learnerCtx.close();

  // Take the fixture back out of learners' view so other specs see a bank without PYQs.
  await page.getByRole('button', { name: 'Approved' }).click();
  await page.getByRole('link', { name: 'e2e-fixture-pyq' }).click();
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByText('Unpublished.')).toBeVisible();
});

test('admin sees that email is not configured and can send a test message', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/email');
  await expect(page.getByTestId('email-status')).toContainText('No email provider is configured.');
  await page.getByRole('button', { name: 'Send a test email to me' }).click();
  await expect(page.getByText('Logged by the development provider. It was not delivered to an inbox.')).toBeVisible();
});
