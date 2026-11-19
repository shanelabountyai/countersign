import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import pg from 'pg';

// Countersign editor against the production build: a template with merge fields and a taxed line, a proposal created
// from it, an in-place draft save, a send from the editor (Phase 3: the PDF is stored and hashed), and a save that supersedes.
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
  await page.getByRole('button', { name: 'Save template' }).last().click();
  await expect(page.getByRole('status')).toHaveText('Template saved.');

  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await page.getByLabel('Template').selectOption({ label: name });
  await page.getByLabel('Title').fill('Acme site');
  await page.getByLabel('Client').fill('Acme Co');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Acme site' })).toBeVisible();
  await expect(page.getByTestId('version-line')).toHaveText(/Version 1.*Draft/);
  await expect(page.getByTestId('total')).toHaveText('$2,706.25'); // 2500 + 8.25 % tax, rounded once (D-18)

  await page.getByLabel('Scope', { exact: true }).fill('a new site');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved.');
  await page.reload();
  await expect(page.getByText('We build a new site for Acme Co.')).toBeVisible();

  const id = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Send version 1' }).click();
  await expect(page.getByRole('status')).toContainText('/sign/');
  const { rows } = await db.query<{ pdfSha256: string }>(`SELECT "pdfSha256" FROM "ProposalVersion" WHERE "proposalId" = $1 AND number = 1 AND status = 'sent'`, [id]);
  expect(rows[0]!.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
  await page.reload();
  await expect(page.getByRole('note')).toContainText('is frozen. Saving creates version 2');
  await page.getByLabel('Line 1 unit price').fill('3000');
  await page.getByRole('button', { name: 'Save as version 2' }).click();
  await expect(page.getByText('Saved as version 2.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Acme site' })).toBeVisible();
  await expect(page.getByTestId('version-line')).toHaveText(/Version 2.*Draft/);
  const v1 = page.getByRole('listitem').filter({ hasText: 'Version 1' });
  await expect(v1).toContainText('Superseded');
  await expect(v1).toContainText(rows[0]!.pdfSha256);
});
