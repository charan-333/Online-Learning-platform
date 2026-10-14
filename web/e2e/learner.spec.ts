import { expect, test } from '@playwright/test';
import { finishOnboardingSkippingDiagnostic, registerLearner } from './helpers';

test('register, onboard, practise a question, and see it in the error log and analytics', async ({ page }) => {
  await registerLearner(page);
  // onboarding is enforced before other pages
  await page.goto('/questions');
  await expect(page).toHaveURL(/\/onboarding/);
  await finishOnboardingSkippingDiagnostic(page);
  await expect(page.getByRole('heading', { name: /Hello, E2E Learner/ })).toBeVisible();
  await expect(page.getByText('No verified CAT PYQs are available yet')).toBeVisible();

  // question bank: honest labelling and filters
  await page.getByRole('link', { name: 'Question bank' }).click();
  await expect(page.getByText('The bank has no verified CAT PYQs yet')).toBeVisible();
  await page.getByLabel('Section', { exact: true }).selectOption('QA');
  await page.getByLabel('Search questions').fill('c100-qa-pct-001');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('1 matching question(s)')).toBeVisible();
  await page.getByRole('link', { name: 'c100-qa-pct-001' }).click();

  // answer wrongly
  await expect(page.getByText('Original practice').first()).toBeVisible();
  await page.getByRole('radio', { name: /A\s*5% increase/ }).check();
  await page.getByLabel('High').check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Not correct. The answer is B.')).toBeVisible();
  // solution views
  await expect(page.getByRole('tab', { name: 'Learn mode' })).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Exam method' }).click();
  await expect(page.getByText('Why the other options are wrong')).toBeVisible();
  await expect(page.getByText('(your choice)')).toBeVisible();
  // reflection
  await page.getByLabel('Not yet').check();
  await page.getByLabel('What went wrong?').selectOption('conceptual_gap');
  await page.getByRole('button', { name: 'Save reflection' }).click();
  await expect(page.getByRole('button', { name: 'Reflection saved' })).toBeVisible();

  // error log
  await page.getByRole('link', { name: 'Error log', exact: true }).click();
  await expect(page.getByRole('link', { name: 'c100-qa-pct-001' })).toBeVisible();
  await expect(page.getByText('Conceptual gap').first()).toBeVisible();

  // analytics reflect the real attempt
  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page.locator('.stat', { hasText: 'Overall' })).toContainText('1 attempt');
  await expect(page.locator('.stat', { hasText: 'Overall' })).toContainText('0%');
  await expect(page.getByText(/No percentile or admission prediction/)).toBeVisible();
});

test('hints and reveal before answering', async ({ page }) => {
  await registerLearner(page);
  await finishOnboardingSkippingDiagnostic(page);
  await page.goto('/questions?q=c100-qa-pct-002');
  await page.getByRole('link', { name: 'c100-qa-pct-002' }).click();
  await page.getByRole('button', { name: 'Show a hint' }).click();
  await expect(page.getByText('Hints', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal solution' }).click();
  await expect(page.getByText(/will not count toward mastery/)).toBeVisible();
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Learn mode' })).toBeVisible();
});

test('daily lesson runs with concept, practice and completion gating', async ({ page }) => {
  await registerLearner(page);
  await finishOnboardingSkippingDiagnostic(page);
  await page.getByRole('link', { name: 'Start today’s lesson' }).click();
  await expect(page.getByRole('heading', { name: /^Lesson:/ })).toBeVisible();
  await page.getByLabel('Length').selectOption('30');
  await expect(page.getByRole('button', { name: /Concept and strategy/ })).toBeVisible();
  await page.getByRole('button', { name: /^Practice/ }).click();
  await page.getByRole('button', { name: 'Finish this block' }).click();
  await expect(page.getByText(/Answer all \d+ questions first/)).toBeVisible();
});

test('syllabus, topic page, formula book and theme toggle', async ({ page }) => {
  await registerLearner(page);
  await finishOnboardingSkippingDiagnostic(page);
  await page.getByRole('link', { name: 'Syllabus' }).click();
  await page.getByRole('link', { name: 'Profit, loss, and discount' }).click();
  await expect(page.getByText('Builds on:').first()).toBeVisible();
  await page.getByRole('link', { name: 'Formula book' }).click();
  await expect(page.locator('.katex-display').first()).toBeVisible();
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(theme === 'dark' || theme === 'light').toBe(true);
});
