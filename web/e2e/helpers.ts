import { expect, type Page } from '@playwright/test';

let n = 0;
export async function registerLearner(page: Page, name = 'E2E Learner') {
  const email = `learner${Date.now()}${n++}@e2e.local`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e learner password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  return email;
}

export async function finishOnboardingSkippingDiagnostic(page: Page) {
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: /Skip for now/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

export async function loginAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@e2e.local');
  await page.getByLabel('Password').fill('e2e admin password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
