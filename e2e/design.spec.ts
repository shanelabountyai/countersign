import { execSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

// Design pass (2026-11-18, docs/design/): the decline confirmation, the owner call "hash on the certificate only", the
// 390 px phone layout, and WCAG 2.1 AA (axe) on every Countersign page against the production build.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL_SYSTEM ?? process.env.DATABASE_URL, max: 1 });
test.afterAll(() => db.end());
test.beforeAll(async () => {
  execSync('npm run seed:demo:test');
  await db.query('DELETE FROM "RateLimit"');
});

/** WCAG 2.1 A and AA rules only; every violation is printed so a failure says which rule and where. */
async function axe(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const found = r.violations.map((v) => `${name}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(found, found.join('\n')).toEqual([]);
}

async function signIn(page: Page) {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();
}

/** As the demo owner: a proposal with a taxed line, an untaxed add-on (off) and terms, sent; returns its link path. */
async function sendProposal(page: Page, title: string) {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Client').fill('Globex');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).nth(1).fill('Scope');
  await page.getByLabel('Text').first().fill('Brand refresh for {{client}}.');
  await page.getByLabel('Kind').nth(1).selectOption('terms');
  await page.getByLabel('Title', { exact: true }).nth(2).fill('Payment');
  await page.getByLabel('Text').nth(1).fill('Half on signature, half on delivery.');
  await page.getByLabel('Line 1 description').fill('Design');
  await page.getByLabel('Line 1 unit price').fill('2,500');
  await page.getByLabel('Line 1 tax rate').fill('8.25');
  await page.getByLabel('Line 2 description').fill('Extra page');
  await page.getByLabel('Line 2 kind').selectOption('per_unit');
  await page.getByLabel('Line 2 unit price').fill('400');
  await page.getByLabel('Line 2 quantity').fill('2');
  await page.getByLabel('Line 2 included').selectOption('optional_off');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved.');
  await page.reload();
  await page.getByRole('button', { name: 'Send version 1' }).click();
  const url = /(http\S+\/sign\/\S+)/.exec((await page.getByRole('status').textContent()) ?? '')?.[1];
  expect(url).toBeTruthy();
  const { rows } = await db.query<{ h: string }>(`SELECT v."pdfSha256" AS h FROM "ProposalVersion" v WHERE v.title = $1 AND v.status = 'sent'`, [title]);
  return { path: new URL(url!).pathname, hash: rows[0]!.h, editor: page.url() };
}

test('decline asks first, records nothing until confirmed, then the link answers 410 "declined"', async ({ page, browser }) => {
  const { path } = await sendProposal(page, `Decline ${Date.now()}`);
  const client = await (await browser.newContext()).newPage();
  await client.goto(path);
  await client.getByRole('button', { name: 'Open proposal' }).click();
  await client.getByText('Decline', { exact: true }).click(); // the disclosure
  const confirm = client.getByRole('group', { name: 'Decline this proposal?' });
  await expect(confirm).toBeVisible();
  await expect(async () => { // closing needs JavaScript; a click before hydration does nothing
    const keep = confirm.getByRole('button', { name: 'Keep reviewing' });
    if (await keep.isVisible()) await keep.click();
    await expect(confirm).toBeHidden({ timeout: 1000 });
  }).toPass();
  expect((await client.request.get(path)).status()).toBe(200); // nothing recorded yet
  await client.getByText('Decline', { exact: true }).click();
  await confirm.getByLabel(/Reason for Acme Studio/).fill('Budget moved to next year.');
  await confirm.getByRole('button', { name: 'Decline this proposal' }).click();
  await expect(client.getByRole('heading', { level: 1 })).toContainText('was declined');
  expect((await client.request.get(path)).status()).toBe(410);
  await axe(client, '410 declined');
});

test('the hash is on the certificate only; signing pages and the editor pass axe; phone layout fits 390 px', async ({ page, browser }) => {
  const { path, hash, editor } = await sendProposal(page, `Design ${Date.now()}`);
  await axe(page, 'proposal editor (sent)');
  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await axe(page, 'proposals list');
  await page.getByRole('navigation').getByRole('link', { name: 'Templates' }).click();
  await axe(page, 'templates list');

  const client = await (await browser.newContext()).newPage();
  await client.goto(path);
  await axe(client, 'signing landing');
  expect(await client.locator('body').innerText()).not.toContain(hash);
  await client.getByRole('button', { name: 'Open proposal' }).click();
  await expect(client.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await client.locator('body').innerText()).not.toContain(hash); // owner call: not on the signing page
  await expect(client.getByText('Half on signature, half on delivery.')).toBeVisible();
  await axe(client, 'review and sign');
  await client.getByText('Decline', { exact: true }).click();
  await axe(client, 'review and sign, decline open');
  await expect(async () => {
    const keep = client.getByRole('button', { name: 'Keep reviewing' });
    if (await keep.isVisible()) await keep.click();
    await expect(keep).toBeHidden({ timeout: 1000 });
  }).toPass();

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto(`${path}/review`);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const sign = phone.getByRole('button', { name: /^Sign for/ });
  expect((await sign.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await axe(phone, 'review and sign at 390 px');

  await client.getByLabel(/Optional: Extra page/).check();
  await client.getByLabel('Full name').fill('Hank Scorpio');
  await client.getByRole('checkbox', { name: /I agree to use electronic records and signatures/ }).check();
  await client.getByRole('button', { name: /^Sign for/ }).click();
  await expect(client.getByRole('heading', { name: 'Signed. Thank you.' })).toBeVisible();
  await expect(client.getByRole('heading', { name: 'Certificate of completion' })).toBeVisible();
  await expect(client.getByText(hash)).toBeVisible(); // on the certificate
  await expect(client.getByRole('cell', { name: /^Signed/ })).toBeVisible();
  await axe(client, 'signed + certificate');

  await page.goto(editor);
  await expect(page.getByText('Signed by Hank Scorpio')).toBeVisible();
  await axe(page, 'proposal editor (signed)');
});

test('templates, verify and the link notices pass axe', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Templates' }).click();
  await page.getByLabel('Name').fill(`Axe ${Date.now()}`);
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await axe(page, 'template editor');
  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await axe(page, 'proposals list');

  const anon = await (await page.context().browser()!.newContext()).newPage();
  await anon.goto('/verify');
  await axe(anon, 'verify form');
  await anon.getByLabel('Proposal PDF or completion certificate').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not a countersign document') });
  await anon.getByRole('button', { name: 'Check this file' }).click();
  await expect(anon.getByRole('status')).toHaveAttribute('data-verdict', 'no_match');
  await axe(anon, 'verify result');
  const missing = await anon.goto('/sign/not-a-real-token');
  expect(missing!.status()).toBe(404);
  await axe(anon, '404 link');
});
