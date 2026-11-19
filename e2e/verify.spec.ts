import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

// Countersign Phase 4 against the production build: a signed proposal's PDF and certificate, downloaded by the client,
// verify on the public /verify page in a fresh browser; the same PDF with one byte flipped does not (CS-02); an unsigned
// proposal's PDF does not either (D-17).
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL_SYSTEM ?? process.env.DATABASE_URL, max: 1 });
test.afterAll(() => db.end());
test.beforeAll(async () => {
  execSync('npm run seed:demo:test');
  await db.query('DELETE FROM "RateLimit"');
});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** As the demo owner: a one-line proposal, sent; returns the signing link path. */
async function sendProposal(page: Page, title: string) {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Client').fill('Globex');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByTestId('version-line')).toHaveText(/Version 1.*Draft/);
  await page.getByLabel('Title', { exact: true }).nth(1).fill('Scope');
  await page.getByLabel('Text').first().fill('Brand refresh for {{client}}.');
  await page.getByLabel('Line 1 description').fill('Design');
  await page.getByLabel('Line 1 unit price').fill('1,200');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved.');
  await page.reload();
  await page.getByRole('button', { name: 'Send version 1' }).click();
  const url = /(http\S+\/sign\/\S+)/.exec((await page.getByRole('status').textContent()) ?? '')?.[1];
  expect(url).toBeTruthy();
  return new URL(url!).pathname;
}

async function upload(browser: Browser, name: string, bytes: Buffer) {
  const p = await (await browser.newContext()).newPage(); // a stranger's browser: no session, no signing link
  const form = await p.goto('/verify');
  expect(form!.status()).toBe(200);
  await p.getByLabel('Proposal PDF or completion certificate').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await p.getByRole('button', { name: 'Check this file' }).click();
  await expect(p.getByRole('status')).toBeVisible();
  return p;
}

test('signed PDF and certificate verify; one flipped byte and an unsigned PDF do not', async ({ page, browser }) => {
  const path = await sendProposal(page, `Verify ${Date.now()}`);
  const client = await (await browser.newContext()).newPage();
  await client.goto(path);
  await client.getByRole('button', { name: 'Open proposal' }).click();
  await client.getByLabel('Full name').fill('Hank Scorpio');
  await client.getByRole('checkbox', { name: /I agree to use electronic records and signatures/ }).check();
  await client.getByRole('button', { name: /^Sign for/ }).click();
  await expect(client.getByRole('heading', { name: 'Signed. Thank you.' })).toBeVisible();
  const pdf = Buffer.from(await (await client.request.get(`${path}/pdf`)).body());
  const cert = Buffer.from(await (await client.request.get(`${path}/certificate`)).body());

  const ok = await upload(browser, 'signed.pdf', pdf);
  await expect(ok.getByRole('status')).toHaveAttribute('data-verdict', 'verified');
  await expect(ok.getByRole('heading', { name: /Verified: this is the signed proposal/ })).toBeVisible();
  await expect(ok.getByText('Hank Scorpio')).toBeVisible();
  await expect(ok.getByTestId('upload-sha256')).toHaveText(sha(pdf));
  await expect(ok.locator('[data-ok="false"]')).toHaveCount(0);
  await expect(ok.locator('[data-ok="true"]')).toHaveCount(8);

  const okCert = await upload(browser, 'certificate.pdf', cert);
  await expect(okCert.getByRole('heading', { name: /Verified: this is the signed completion certificate/ })).toBeVisible();

  const tampered = Buffer.from(pdf);
  tampered[Math.floor(tampered.length / 2)]! ^= 0x01;
  const bad = await upload(browser, 'tampered.pdf', tampered);
  await expect(bad.getByRole('status')).toHaveAttribute('data-verdict', 'no_match');
  await expect(bad.getByRole('heading', { name: 'Not verified' })).toBeVisible();
  await expect(bad.getByTestId('upload-sha256')).toHaveText(sha(tampered));
  await expect(bad.getByText('Hank Scorpio')).toHaveCount(0);

  const unsignedPath = await sendProposal(page, `Unsigned ${Date.now()}`);
  const unsigned = Buffer.from(await (await page.request.get(`${unsignedPath}/pdf`)).body());
  const no = await upload(browser, 'unsigned.pdf', unsigned);
  await expect(no.getByRole('status')).toHaveAttribute('data-verdict', 'not_signed');
  await expect(no.getByRole('heading', { name: /never signed/ })).toBeVisible();
});
