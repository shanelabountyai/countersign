import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import pg from 'pg';

// Countersign Phase 2 editor against the production build: a template with merge fields and a taxed line, a proposal
// created from it, an in-place draft save, and (after a send recorded in the database, D-19) a save that supersedes.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL_SYSTEM ?? process.env.DATABASE_URL, max: 1 });
test.afterAll(() => db.end());
test.beforeAll(async () => {
  execSync('npm run seed:demo:test'); // as in demo.spec.ts (F-08)
  await db.query('DELETE FROM "RateLimit"');
});

test('template → proposal → draft save → supersede after send', async ({ page }) => {
  const name = `Web build ${Date.now()}`;
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Templates' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByLabel('Title').first().fill('Scope');
  await page.getByLabel('Text').first().fill('We build {{scope}} for {{client}}.');
  await page.getByLabel('Line 1 description').fill('Design');
  await page.getByLabel('Line 1 unit price').fill('2,500');
  await page.getByLabel('Line 1 tax rate').fill('8.25');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('status')).toHaveText('Template saved.');

  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await page.getByLabel('Template').selectOption({ label: name });
  await page.getByLabel('Title').fill('Acme site');
  await page.getByLabel('Client').fill('Acme Co');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { name: /Acme site v1 · draft/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /^Total/ })).toContainText('$2,706.25'); // 2500 + 8.25 % tax, rounded once (D-18)

  await page.getByLabel('Scope', { exact: true }).fill('a new site');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved.');
  await page.reload();
  await expect(page.getByText('We build a new site for Acme Co.')).toBeVisible();

  // Phase 3 will send from the UI; here the send is recorded directly (the trigger requires a canonical hash).
  const id = page.url().split('/').pop()!;
  await db.query(`UPDATE "ProposalVersion" SET status = 'sent', "statusAt" = now(), "pdfSha256" = $2 WHERE "proposalId" = $1 AND number = 1`, [id, 'e'.repeat(64)]);
  await page.reload();
  await expect(page.getByRole('note')).toContainText('is frozen. Saving creates version 2');
  await page.getByLabel('Line 1 unit price').fill('3000');
  await page.getByRole('button', { name: 'Save as version 2' }).click();
  await expect(page.getByText('Saved as version 2.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Acme site v2 · draft/ })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'v1: superseded' })).toContainText('eeeeeeeeeeee');
});
