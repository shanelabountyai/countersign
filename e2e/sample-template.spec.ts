import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import pg from 'pg';

// Countersign Phase 4 (D-43): the owner adds the Lab Intelligence sample template and starts a proposal from it; the
// SAMPLE notice is its first section and every price is $0.00 until the author sets one.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL_SYSTEM ?? process.env.DATABASE_URL, max: 1 });
test.afterAll(() => db.end());
test.beforeAll(async () => {
  execSync('npm run seed:demo:test');
  await db.query('DELETE FROM "RateLimit"');
});

test('add the sample template → proposal from it shows the SAMPLE section and a $0.00 total', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'Add the sample template' }).click();
  await expect(page.getByRole('heading', { name: 'SAMPLE: Lab Intelligence AI adoption assessment' })).toBeVisible();
  const templateId = page.url().split('/').pop()!;
  await expect(page.getByLabel('Text').first()).toHaveValue(/This is a sample template/);

  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await page.waitForURL(/\/proposals$/);
  await page.locator('select[name="templateId"]').selectOption(templateId);
  await page.getByLabel('Title').fill(`AI assessment ${Date.now()}`);
  await page.getByLabel('Client').fill('Example Client');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { name: /AI assessment \d+ v1 · draft/ })).toBeVisible();
  await expect(page.getByLabel('Text').first()).toHaveValue(/This is a sample template/);
  await expect(page.getByRole('row', { name: /^Total/ })).toContainText('$0.00');
});
