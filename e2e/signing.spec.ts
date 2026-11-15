import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

// Countersign Phase 3 against the production build: the owner sends; the client opens the link, toggles an add-on,
// signs (typed, then drawn on a second proposal) and downloads the PDF and the certificate, whose bytes match the
// recorded hashes (CS-02). An edit after send makes the old link answer HTTP 410 (CS-03).
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL_SYSTEM ?? process.env.DATABASE_URL, max: 1 });
test.afterAll(() => db.end());
test.beforeAll(async () => {
  execSync('npm run seed:demo:test');
  await db.query('DELETE FROM "RateLimit"');
});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** As the demo owner: a blank proposal with a taxed line and an optional add-on (off), sent; returns its id and link. */
async function sendProposal(page: Page, title: string) {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'owner@acme.demo.test' }).click();
  await page.getByRole('link', { name: 'Acme Studio' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Proposals' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Client').fill('Globex');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`${title} v1 · draft`) })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).nth(1).fill('Scope');
  await page.getByLabel('Text').first().fill('Brand refresh for {{client}}.');
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
  const notice = await page.getByRole('status').textContent();
  const url = /(http\S+\/sign\/\S+)/.exec(notice ?? '')?.[1];
  expect(url).toBeTruthy();
  return { id: page.url().split('/').pop()!, path: new URL(url!).pathname };
}

test('send → open → add-on → typed signature → downloads match the recorded hashes', async ({ page, browser }) => {
  const { id, path } = await sendProposal(page, `Brand ${Date.now()}`);
  const client = await (await browser.newContext()).newPage();
  const landing = await client.goto(path);
  expect(landing!.status()).toBe(200);
  expect(landing!.headers()['referrer-policy']).toBe('no-referrer');
  await client.getByRole('button', { name: 'Open proposal' }).click();
  await expect(client.getByText('Brand refresh for Globex.')).toBeVisible();
  await expect(client.getByTestId('total')).toHaveText('$2,706.25');
  await client.getByLabel(/Extra page \(optional\)/).check();
  await expect(client.getByTestId('total')).toHaveText('$3,506.25'); // the add-on is untaxed: 2,706.25 + 800
  await client.getByLabel('Full name').fill('Hank Scorpio');
  await client.getByLabel('Type your signature').fill('Hank Scorpio');
  await client.getByRole('checkbox', { name: /I agree to do business electronically/ }).check();
  await client.getByRole('button', { name: 'Sign for $3,506.25' }).click();
  await expect(client.getByRole('heading', { name: 'Signed. Thank you.' })).toBeVisible();

  const { rows } = await db.query<{ v: string; pdf: string; cert: string; total: string }>(
    `SELECT v.id AS v, v."pdfSha256" AS pdf, d.sha256 AS cert, s."totalCents"::text AS total FROM "ProposalVersion" v
     JOIN "ProposalDocument" d ON d."versionId" = v.id AND d.kind = 'certificate' JOIN "ProposalSignature" s ON s."versionId" = v.id
     WHERE v."proposalId" = $1 AND v.status = 'signed'`, [id]);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.total).toBe('350625');
  const pdf = await client.request.get(`${path}/pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(sha(await pdf.body())).toBe(rows[0]!.pdf);
  const cert = await client.request.get(`${path}/certificate`);
  expect(sha(await cert.body())).toBe(rows[0]!.cert);

  await page.reload(); // the owner sees the signature and both documents
  await expect(page.getByText('Signed by Hank Scorpio')).toBeVisible();
  const ownerPdf = await page.request.get(`${new URL(page.url()).pathname}/pdf?v=1&kind=proposal`);
  expect(sha(await ownerPdf.body())).toBe(rows[0]!.pdf);
});

test('a drawn signature; an edit after send makes the old link HTTP 410', async ({ page, browser }) => {
  const first = await sendProposal(page, `Drawn ${Date.now()}`);
  const client = await (await browser.newContext()).newPage();
  await client.goto(first.path);
  await client.getByRole('button', { name: 'Open proposal' }).click();
  await client.getByLabel('Full name').fill('Hank Scorpio');
  await client.getByRole('radio', { name: 'Draw' }).check();
  const box = (await client.getByTestId('signature-pad').boundingBox())!;
  await client.mouse.move(box.x + 20, box.y + box.height * 0.7);
  await client.mouse.down();
  for (const [fx, fy] of [[0.2, 0.2], [0.4, 0.8], [0.6, 0.3], [0.85, 0.6]] as const) await client.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 8 });
  await client.mouse.up();
  await client.getByRole('checkbox', { name: /I agree to do business electronically/ }).check();
  await client.getByRole('button', { name: /^Sign for/ }).click();
  await expect(client.getByRole('heading', { name: 'Signed. Thank you.' })).toBeVisible();
  const { rows } = await db.query<{ method: string; data: string }>(`SELECT s.method, s."signatureData" AS data FROM "ProposalSignature" s JOIN "ProposalVersion" v ON v.id = s."versionId" WHERE v."proposalId" = $1`, [first.id]);
  expect(rows[0]!.method).toBe('drawn');
  expect(rows[0]!.data).toMatch(/^M\d+ \d+( L\d+ \d+)+$/);

  const second = await sendProposal(page, `Superseded ${Date.now()}`);
  expect((await page.request.get(second.path)).status()).toBe(200);
  await page.reload();
  await page.getByLabel('Line 1 unit price').fill('3000');
  await page.getByRole('button', { name: 'Save as version 2' }).click();
  await expect(page.getByText('Saved as version 2.')).toBeVisible();
  const gone = await page.request.get(second.path);
  expect(gone.status()).toBe(410);
  expect(await gone.text()).toContain('earlier version');
  expect((await page.request.get(`${second.path}/pdf`)).status()).toBe(410);
});
