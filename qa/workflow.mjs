// Browser workflow QA for Tessera. Run: NODE_PATH=<tools>/node_modules node qa/workflow.mjs http://127.0.0.1:6120/
// Captures screenshots and asserts the main flow: select tile -> trace -> add evidence -> decision -> import rejection -> export.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:6120/';
const out = path.resolve('qa/screens');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const log = [];
const check = (name, cond) => { log.push({ name, pass: !!cond }); if (!cond) console.error('FAIL', name); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(out, '01-desktop-initial.png'), fullPage: true });

  // Default selection PR.DS-11 is the contradicted fixture.
  check('drawer shows PR.DS-11', await page.locator('.drawer__id').textContent() === 'PR.DS-11');
  check('status contradicted', (await page.locator('.facts .status').textContent())?.includes('contradicted'));
  check('reviewer acceptance refused banner', await page.locator('.warnbox').count() === 1);

  // Select a tile with none status (DE.CM-01: stale only)
  await page.getByRole('button', { name: /^DE\.CM-01:/ }).click();
  check('hash deep link', page.url().endsWith('#/DE.CM-01'));
  const remediation = await page.locator('.remediation').textContent();
  check('stale remediation text', /stale/i.test(remediation ?? ''));
  await page.screenshot({ path: path.join(out, '02-drawer-stale.png'), fullPage: false });

  // Add fresh evidence -> status should move to weak/partial
  await page.getByLabel('Title').fill('IDS alert export (current)');
  await page.getByLabel('Type').selectOption('log-sample');
  await page.getByLabel('Valid for (days)').fill('90');
  await page.getByRole('button', { name: 'Add evidence' }).click();
  const statusAfter = await page.locator('.facts .status').textContent();
  check('status recomputed after add', statusAfter?.trim() === 'partial');
  await page.getByLabel('Title').fill('Network monitoring procedure');
  await page.getByLabel('Type').selectOption('procedure');
  await page.getByRole('button', { name: 'Add evidence' }).click();
  check('two types -> sufficient', (await page.locator('.facts .status').textContent())?.trim() === 'sufficient');
  await page.screenshot({ path: path.join(out, '03-after-evidence.png'), fullPage: false });

  // Decision: short N/A rationale must be refused
  await page.getByRole('button', { name: /^GV\.RM-02:/ }).click();
  await page.getByLabel('Reviewer', { exact: true }).fill('qa.bot');
  await page.getByLabel('Verdict').selectOption('not-applicable');
  await page.getByLabel(/Rationale/).fill('n/a');
  await page.getByRole('button', { name: 'Record decision' }).click();
  check('short N/A refused', (await page.locator('.warnbox').textContent())?.includes('substantive'));
  await page.getByLabel(/Rationale/).fill('Risk appetite is set at group level by the parent board; this entity adopts the group statement by reference (minute GB-2026-03).');
  await page.getByRole('button', { name: 'Record decision' }).click();
  check('substantive N/A accepted', (await page.locator('.facts .status').textContent())?.includes('not-applicable'));
  await page.screenshot({ path: path.join(out, '04-decision.png'), fullPage: false });

  // Import rejection with bad JSON
  const fileInput = page.locator('input[type=file]');
  await fileInput.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"tessera.pack/1","profile":{"name":"x","asOf":"2026-13-40"},"evidence":[{"id":"E1"}]}') });
  await page.waitForSelector('.notice--error');
  check('import rejected with details', (await page.locator('.notice--error li').count()) > 0);
  await page.screenshot({ path: path.join(out, '05-import-rejected.png'), fullPage: false });

  // Export CSV download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export report CSV' }).click()]);
  const csvPath = await dl.path();
  const csv = await fs.readFile(csvPath, 'utf8');
  check('csv has header + 25 rows', csv.split('\r\n').length === 26);
  await fs.writeFile(path.join(out, 'export-sample.csv'), csv);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export report JSON' }).click()]);
  const rep = JSON.parse(await fs.readFile(await dl2.path(), 'utf8'));
  check('report schema', rep.schema === 'tessera.report/1' && rep.results.length === 25);

  // Empty state
  await page.getByRole('button', { name: 'Start empty' }).click();
  check('empty gap register has 25 gaps', (await page.locator('.gaps tbody tr').count()) === 25);
  await page.screenshot({ path: path.join(out, '06-empty-profile.png'), fullPage: false });

  // Keyboard: tab to first tile and press Enter
  await page.getByRole('button', { name: 'Load demo pack' }).click();
  await page.locator('.tile').first().focus();
  await page.keyboard.press('Enter');
  check('keyboard selects tile', (await page.locator('.drawer__id').textContent()) === 'GV.OC-03');

  check('no page/console errors', errors.length === 0);
  if (errors.length) console.error(errors);
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(url + '#/PR.DS-11', { waitUntil: 'networkidle' });
  await mp.screenshot({ path: path.join(out, '07-mobile.png'), fullPage: true });
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  check('mobile no horizontal overflow', sw <= 375);
  await m.close();
} finally {
  await browser.close();
}
await fs.writeFile(path.join(out, 'workflow-results.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log));
process.exit(log.every((l) => l.pass) ? 0 : 1);
