#!/usr/bin/env node
// Browser workflow QA for Tessera (Chromium via Playwright), run against a server that sends the production
// headers from vercel.json — normally `node qa/serve-dist.mjs --port 6120` on a fresh `npm run build`.
// (`vite preview` does not apply vercel.json, so the header and CSP checks below would fail against it.)
//
//   node qa/workflow.mjs [--url http://127.0.0.1:6120/] [--out qa/screens]
//
// Playwright is not a repo dependency. It is loaded with a dynamic import and found either in an ancestor
// node_modules directory or through NODE_PATH (see qa/README.md). Exit codes: 0 all checks pass, 1 a check
// failed, 2 Playwright or a browser is unavailable.
//
// The page runs under the enforced Content-Security-Policy: every securitypolicyviolation event, every
// "Refused to …" console line and every request to a foreign origin is collected and must be empty.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INSTALL_HINT = "Install playwright (and @axe-core/playwright) in a scratch directory and point NODE_PATH at its node_modules; browsers come from Playwright's default cache or PLAYWRIGHT_BROWSERS_PATH";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// ---------- optional dependency loading ----------

async function loadOptional(name) {
  const notFound = (err) => (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') && String(err?.message).includes(name);
  try {
    return await import(name);
  } catch (err) {
    if (!notFound(err)) throw err;
  }
  try {
    // CommonJS resolution honours NODE_PATH, which the ESM resolver ignores.
    const entry = createRequire(import.meta.url).resolve(name);
    return await import(pathToFileURL(entry).href);
  } catch (err) {
    if (!notFound(err)) throw err;
  }
  return null;
}

function pickChromium(mod) {
  const candidates = [mod?.chromium, mod?.default?.chromium];
  return candidates.find((c) => c && typeof c.launch === 'function') ?? null;
}

// ---------- arguments ----------

function parseArgs(argv) {
  const opts = { url: 'http://127.0.0.1:6120/', out: 'qa/screens', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') opts.url = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (i === 0 && !arg.startsWith('--')) opts.url = arg;
    else {
      console.error(`workflow: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  if (!opts.url || !opts.out) {
    console.error('workflow: --url and --out need values');
    process.exit(2);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log('usage: node qa/workflow.mjs [--url http://127.0.0.1:6120/] [--out qa/screens]');
  process.exit(0);
}
const base = new URL(opts.url);
const servedOrigin = base.origin;
const out = path.resolve(opts.out);
await fs.mkdir(out, { recursive: true });

const vercel = JSON.parse(await fs.readFile(path.join(repoRoot, 'vercel.json'), 'utf8'));
const expectedCsp = (vercel.headers ?? []).flatMap((r) => r.headers).find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;
if (!expectedCsp) {
  console.error('workflow: vercel.json has no Content-Security-Policy header');
  process.exit(1);
}

const chromium = pickChromium(await loadOptional('playwright'));
if (!chromium) {
  console.error(`workflow: the Playwright library could not be loaded. ${INSTALL_HINT}`);
  process.exit(2);
}

// ---------- bookkeeping ----------

const results = [];
function record(name, pass, detail) {
  const entry = { name, pass: Boolean(pass) };
  if (detail) entry.detail = String(detail).slice(0, 400);
  results.push(entry);
  console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${name}${entry.detail ? `  — ${entry.detail}` : ''}`);
}
async function step(name, fn) {
  try {
    const r = await fn();
    if (typeof r === 'boolean') record(name, r);
    else record(name, r?.pass, r?.detail);
  } catch (err) {
    record(name, false, `error: ${err?.message ?? err}`);
  }
}

function newBag() {
  return { errors: [], cspConsole: [], dialogs: [], foreignRequests: [], failedRequests: [], responses: {} };
}

function cspProbe() {
  document.addEventListener('securitypolicyviolation', (e) => {
    (window.__cspViolations ||= []).push({ directive: e.violatedDirective, blocked: e.blockedURI, line: e.lineNumber });
  });
}

function instrument(page, bag) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error') bag.errors.push(`console.error: ${text}`);
    if (/Content Security Policy|Refused to/.test(text)) bag.cspConsole.push(text);
  });
  page.on('dialog', (d) => {
    bag.dialogs.push(d.type() + ': ' + d.message());
    d.accept().catch(() => {});
  });
  page.on('request', (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    let origin = u;
    try {
      origin = new URL(u).origin;
    } catch {
      /* keep the raw URL so it shows up as foreign */
    }
    if (origin !== servedOrigin) bag.foreignRequests.push(u);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    const reason = r.failure()?.errorText ?? 'failed';
    if (reason === 'net::ERR_ABORTED') return; // download navigations are aborted by design
    bag.failedRequests.push(`${reason} ${urlPath(u)}`);
  });
  page.on('response', (res) => {
    const p = urlPath(res.url());
    if (!p.startsWith('/')) return;
    const entry = { path: p, status: res.status(), headers: res.headers() };
    if (res.status() >= 400 && p !== '/favicon.ico') bag.failedRequests.push(`HTTP ${res.status()} ${p}`);
    if (!bag.responses.js && /^\/assets\/.+\.js$/.test(p)) bag.responses.js = entry;
    if (!bag.responses.css && /^\/assets\/.+\.css$/.test(p)) bag.responses.css = entry;
    if (!bag.responses.woff2 && /\.woff2$/.test(p)) bag.responses.woff2 = entry;
  });
}

function urlPath(u) {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
}

// ---------- page helpers ----------

const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60))));

async function revealIfCollapsed(locator) {
  const closed = locator.locator('xpath=ancestor::details[not(@open)]');
  const n = await closed.count();
  for (let i = 0; i < n; i++) await closed.nth(i).locator('xpath=./summary').first().click();
}

async function clickButton(page, name) {
  let btn = page.getByRole('button', { name, exact: true });
  if (!(await btn.count())) btn = page.getByRole('button', { name });
  if (!(await btn.count())) throw new Error(`button "${name}" not found`);
  btn = btn.first();
  await revealIfCollapsed(btn);
  await btn.click();
}

async function openDetails(page, summaryText) {
  const details = page.locator('details', { has: page.locator('summary', { hasText: summaryText }) }).first();
  await details.waitFor();
  if (!(await details.evaluate((el) => el.open))) await details.locator('summary').first().click();
}

async function tile(page, id) {
  const byData = page.locator(`[data-tile-id="${id}"]`);
  if (await byData.count()) return byData.first();
  return page.getByRole('button', { name: new RegExp('^' + id.replace(/\./g, '\\.') + ':') });
}

async function firstWithMatches(page, selectors) {
  for (const s of selectors) {
    const l = page.locator(s);
    if (await l.count()) return l.first();
  }
  return page.locator(selectors[selectors.length - 1]).first();
}

const evidenceForm = (page) => firstWithMatches(page, ['.addform', '.evform', '.drawer']);
const decisionForm = (page) => firstWithMatches(page, ['.decision', '.drawer']);
const packFileInput = (page) => firstWithMatches(page, ['[role=group][aria-label="Pack actions"] input[type=file]', '.profile__actions input[type=file]', 'input[type=file]']);

const statusText = async (page) => ((await page.locator('.facts .status').first().textContent()) ?? '').trim();
const waitForStatus = (page, want) => page.waitForFunction((w) => document.querySelector('.facts .status')?.textContent?.trim() === w, want, { timeout: 8000 }).catch(() => {});
const waitForText = (page, selector, want) => page.waitForFunction(([s, w]) => document.querySelector(s)?.textContent?.trim() === w, [selector, want], { timeout: 8000 }).catch(() => {});

async function downloadText(page, buttonName) {
  const [dl] = await Promise.all([page.waitForEvent('download'), clickButton(page, buttonName)]);
  return fs.readFile(await dl.path(), 'utf8');
}

async function anyVisible(locator) {
  const n = await locator.count();
  for (let i = 0; i < n; i++) if (await locator.nth(i).isVisible()) return true;
  return false;
}

const effectiveBackground = (page) =>
  page.evaluate(() => {
    const bg = (el) => getComputedStyle(el).backgroundColor;
    const body = bg(document.body);
    return body && body !== 'rgba(0, 0, 0, 0)' && body !== 'transparent' ? body : bg(document.documentElement);
  });

// ---------- run ----------

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.error(`workflow: could not launch Chromium (${err?.message?.split('\n')[0]}). ${INSTALL_HINT}`);
  process.exit(2);
}

const bag = newBag();
const mobileBag = newBag();
let cspViolations = [];
let mobileCspViolations = [];
const NEW_TITLE = 'Backup job configuration (nightly, encrypted, restore-verified)';

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  await page.addInitScript(cspProbe);
  instrument(page, bag);
  const mainResponse = await page.goto(base.href, { waitUntil: 'networkidle' });
  bag.responses.index = { path: urlPath(mainResponse.url()), status: mainResponse.status(), headers: mainResponse.headers() };
  await page.screenshot({ path: path.join(out, '01-desktop-initial.png'), fullPage: true });

  await step('fonts load under font-src self', async () => {
    const info = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, status: f.status }));
      return { check: document.fonts.check('12px Fraunces'), faces };
    });
    const errored = info.faces.filter((f) => f.status === 'error');
    const fraunces = info.faces.some((f) => /fraunces/i.test(f.family) && f.status === 'loaded');
    return { pass: info.check && errored.length === 0 && fraunces, detail: `fonts.check(Fraunces)=${info.check}; ${info.faces.length} face(s), ${errored.length} in error${errored.length ? ': ' + errored.map((f) => `${f.family} ${f.weight}`).join(', ') : ''}` };
  });

  // Default selection PR.DS-11 is the contradicted fixture.
  await step('drawer shows PR.DS-11', async () => (await page.locator('.drawer__id').textContent()) === 'PR.DS-11');
  await step('status contradicted', async () => (await statusText(page)).includes('contradicted'));
  await step('reviewer acceptance refused banner', async () => {
    const boxes = page.locator('.warnbox');
    const n = await boxes.count();
    const text = (await boxes.allTextContents()).join(' ');
    return { pass: n >= 1 && /refused/i.test(text), detail: `${n} warnbox(es)` };
  });

  // 0.2: edit an artifact in place, remove it behind a confirm dialog, undo the removal.
  await step('edit evidence', async () => {
    await clickButton(page, 'Edit EV-004');
    await page.getByRole('heading', { name: 'Edit evidence EV-004' }).first().waitFor();
    const form = await evidenceForm(page);
    await form.getByLabel('Title').fill(NEW_TITLE);
    await clickButton(page, 'Save changes');
    await page.locator('.evlist').getByText(NEW_TITLE).first().waitFor();
    const list = (await page.locator('.evlist').allTextContents()).join(' ');
    return { pass: list.includes(NEW_TITLE) && (await page.locator('.drawer__id').textContent()) === 'PR.DS-11', detail: 'EV-004 title updated in the drawer list' };
  });
  await step('remove confirm dialog recorded', async () => {
    const before = bag.dialogs.length;
    await clickButton(page, 'Remove EV-004');
    await page.getByRole('button', { name: 'Remove EV-004' }).waitFor({ state: 'detached' });
    const seen = bag.dialogs.slice(before);
    return { pass: seen.some((d) => d.startsWith('confirm:')), detail: seen.join(' | ') || 'no dialog was raised' };
  });
  await step('undo restores evidence', async () => {
    const gone = !(await page.locator('.evlist').allTextContents()).join(' ').includes('EV-004');
    await clickButton(page, 'Undo');
    await page.locator('.evlist').getByText('EV-004').first().waitFor();
    const back = (await page.locator('.evlist').allTextContents()).join(' ').includes('EV-004');
    return { pass: gone && back, detail: gone ? 'EV-004 removed, then restored by Undo' : 'EV-004 was never removed' };
  });

  // Select a tile with none status (DE.CM-01: stale only).
  await step('hash deep link', async () => {
    await (await tile(page, 'DE.CM-01')).click();
    await waitForText(page, '.drawer__id', 'DE.CM-01');
    return page.url().endsWith('#/DE.CM-01');
  });
  await step('stale remediation text', async () => /stale/i.test((await page.locator('.remediation').first().textContent()) ?? ''));
  await page.screenshot({ path: path.join(out, '02-drawer-stale.png'), fullPage: false });

  // Add fresh evidence -> status should move to partial, then sufficient with a second type.
  await step('status recomputed after add', async () => {
    const form = await evidenceForm(page);
    await form.getByLabel('Title').fill('IDS alert export (current)');
    await form.getByLabel('Type').selectOption('log-sample');
    await form.getByLabel('Valid for (days)').fill('90');
    await clickButton(page, 'Add evidence');
    await waitForStatus(page, 'partial');
    return (await statusText(page)) === 'partial';
  });
  await step('two types -> sufficient', async () => {
    const form = await evidenceForm(page);
    await form.getByLabel('Title').fill('Network monitoring procedure');
    await form.getByLabel('Type').selectOption('procedure');
    await clickButton(page, 'Add evidence');
    await waitForStatus(page, 'sufficient');
    return (await statusText(page)) === 'sufficient';
  });
  await page.screenshot({ path: path.join(out, '03-after-evidence.png'), fullPage: false });

  // Decision: short N/A rationale must be refused, a substantive one accepted.
  await step('short N/A refused', async () => {
    await (await tile(page, 'GV.RM-02')).click();
    await waitForText(page, '.drawer__id', 'GV.RM-02');
    const form = await decisionForm(page);
    await form.getByLabel('Reviewer', { exact: true }).fill('qa.bot');
    await form.getByLabel('Verdict').selectOption('not-applicable');
    await form.getByLabel(/Rationale/).fill('n/a');
    await clickButton(page, 'Record decision');
    await page.locator('.warnbox').first().waitFor();
    return (await page.locator('.warnbox').allTextContents()).join(' ').includes('substantive');
  });
  await step('substantive N/A accepted', async () => {
    const form = await decisionForm(page);
    await form.getByLabel('Reviewer', { exact: true }).fill('qa.bot');
    await form.getByLabel('Verdict').selectOption('not-applicable');
    await form.getByLabel(/Rationale/).fill('Risk appetite is set at group level by the parent board; this entity adopts the group statement by reference (minute GB-2026-03).');
    await clickButton(page, 'Record decision');
    await waitForStatus(page, 'not-applicable');
    return (await statusText(page)).includes('not-applicable');
  });
  await page.screenshot({ path: path.join(out, '04-decision.png'), fullPage: false });

  // Import rejection with bad JSON (path-addressed details).
  await step('import rejected with details', async () => {
    const input = await packFileInput(page);
    await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"tessera.pack/1","profile":{"name":"x","asOf":"2026-13-40"},"evidence":[{"id":"E1"}]}') });
    await page.waitForSelector('.notice--error');
    return (await page.locator('.notice--error li').count()) > 0;
  });
  await page.screenshot({ path: path.join(out, '05-import-rejected.png'), fullPage: false });

  // Exports (real downloads under the enforced CSP).
  await step('csv has header + 25 rows', async () => {
    const csv = await downloadText(page, 'Export report CSV');
    await fs.writeFile(path.join(out, 'export-sample.csv'), csv);
    return csv.split('\r\n').length === 26;
  });
  await step('report schema', async () => {
    const rep = JSON.parse(await downloadText(page, 'Export report JSON'));
    return rep.schema === 'tessera.report/1' && rep.results.length === 25;
  });

  // Empty state.
  await step('empty gap register has 25 gaps', async () => {
    await clickButton(page, 'Start empty');
    await page.waitForFunction(() => document.querySelectorAll('.gaps tbody tr').length === 25, null, { timeout: 8000 }).catch(() => {});
    return (await page.locator('.gaps tbody tr').count()) === 25;
  });
  await page.screenshot({ path: path.join(out, '06-empty-profile.png'), fullPage: false });

  // Keyboard: focus the first tile and press Enter.
  await step('keyboard selects tile', async () => {
    await clickButton(page, 'Load demo pack');
    await waitForText(page, '.drawer__id', 'PR.DS-11');
    const first = (await page.locator('[data-tile-id]').count()) ? page.locator('[data-tile-id]').first() : page.locator('.tile').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await waitForText(page, '.drawer__id', 'GV.OC-03');
    return (await page.locator('.drawer__id').textContent()) === 'GV.OC-03';
  });

  // 0.2: horizon forecast on the fresh demo pack (asOf 2026-10-01): EV-003 turns aging on 2026-12-22.
  await step('horizon lists EV-003 at 90 days', async () => {
    const select = page.getByLabel('Horizon (days)');
    const panelText = () => select.evaluate((el) => (el.closest('section') ?? el.closest('[class*="horizon"]') ?? document.body).textContent ?? '');
    await select.selectOption('60');
    await settle(page);
    const at60 = (await panelText()).includes('EV-003');
    await select.selectOption('90');
    await settle(page);
    const at90 = (await panelText()).includes('EV-003');
    return { pass: at90 && !at60, detail: `EV-003 listed at 60 days: ${at60}; at 90 days: ${at90}` };
  });

  // 0.2: compare the current evaluation with its own exported report → everything unchanged.
  await step('compare self import → all unchanged', async () => {
    const report = await downloadText(page, 'Export report JSON');
    const heading = page.getByRole('heading', { name: 'Compare with a previous report' }).first();
    await heading.waitFor();
    const container = heading.locator('xpath=ancestor::*[.//input[@type="file"]][1]');
    await container.locator('input[type=file]').first().setInputFiles({ name: 'tessera-report-previous.json', mimeType: 'application/json', buffer: Buffer.from(report) });
    await container.getByText(/\d+ unchanged/).first().waitFor();
    const text = await container.evaluate((el) => el.textContent ?? '');
    const summary = /\d+ improved · \d+ regressed · \d+ unchanged/.exec(text)?.[0] ?? text.slice(0, 120);
    return { pass: text.includes('25 unchanged'), detail: summary };
  });

  // 0.2: rule policy — a 10-character minimum makes the fixture's "Looks fine." override valid.
  await step('policy min rationale 10 → GV.PO-01 sufficient', async () => {
    await openDetails(page, 'Rule policy');
    await page.getByLabel('Minimum override rationale (characters)').fill('10');
    await settle(page);
    await (await tile(page, 'GV.PO-01')).click();
    await waitForStatus(page, 'sufficient');
    return (await statusText(page)) === 'sufficient';
  });
  await step('custom policy badge shown', async () => {
    const badge = page.getByText(/custom policy/i);
    const visible = await anyVisible(badge);
    return { pass: visible, detail: `${await badge.count()} element(s) with "custom policy"` };
  });
  await step('policy reset restores default', async () => {
    await openDetails(page, 'Rule policy');
    await clickButton(page, 'Reset to defaults');
    await waitForStatus(page, 'partial');
    const badgeVisible = await anyVisible(page.getByText(/custom policy/i));
    const status = await statusText(page);
    return { pass: status === 'partial' && !badgeVisible, detail: `GV.PO-01 ${status}; badge visible: ${badgeVisible}` };
  });

  // 0.2: gap register filtering and the executive summary.
  await step('gap register filter by function', async () => {
    const fn = page.getByLabel('Function', { exact: true });
    await fn.selectOption('GV');
    await settle(page);
    const rows = page.locator('.gaps tbody tr');
    const n = await rows.count();
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(((await rows.nth(i).locator('.linkish').first().textContent()) ?? '').trim());
    await fn.selectOption({ index: 0 }).catch(() => {});
    return { pass: n > 0 && ids.every((id) => id.startsWith('GV')), detail: ids.join(', ') || 'no rows' };
  });
  await step('summary present', async () => {
    const heading = page.getByRole('heading', { name: 'Summary', exact: true }).first();
    await heading.waitFor();
    const section = heading.locator('xpath=ancestor::section[1]');
    const scope = (await section.count()) ? section : page;
    const visuals = await scope.locator('[role=img][aria-label], [role=img][aria-labelledby], meter, svg[aria-label], svg[aria-labelledby]').count();
    return { pass: (await heading.isVisible()) && visuals >= 1, detail: `${visuals} accessible visual(s)` };
  });

  // 0.2: the new exports.
  await step('markdown export downloaded', async () => {
    const md = await downloadText(page, 'Export summary (Markdown)');
    await fs.writeFile(path.join(out, 'export-summary-sample.md'), md);
    const last = md.trimEnd().split('\n').pop() ?? '';
    return { pass: last.startsWith('Generated by Tessera (educational prototype)'), detail: last.slice(0, 120) };
  });
  await step('gap register CSV rows = gaps+1', async () => {
    const rep = JSON.parse(await downloadText(page, 'Export report JSON'));
    const csv = await downloadText(page, 'Export gap register CSV');
    const lines = csv.split('\r\n').length;
    return { pass: lines === rep.gaps.length + 1, detail: `${lines} line(s) for ${rep.gaps.length} gap(s)` };
  });
  await step('evidence inventory CSV has header', async () => {
    const pack = JSON.parse(await downloadText(page, 'Export pack'));
    const csv = await downloadText(page, 'Export evidence inventory CSV');
    const lines = csv.split('\r\n');
    const header = lines[0].charCodeAt(0) === 0xfeff ? lines[0].slice(1) : lines[0]; // CSV downloads carry a UTF-8 BOM for spreadsheets
    const columns = header.split(',').length;
    return { pass: /id/i.test(header) && columns >= 5 && lines.length === pack.evidence.length + 1, detail: `${columns} columns, ${lines.length} line(s) for ${pack.evidence.length} artifact(s): ${header.slice(0, 100)}` };
  });

  // 0.2: session safety — opt-in persistence is visible, writes only when asked, and can be forgotten.
  await step('session checkbox present', async () => {
    const cb = page.getByRole('checkbox', { name: 'Keep this session in this browser' });
    return (await cb.count()) === 1 && (await cb.first().isVisible());
  });
  await step('session persistence opt-in saves and forgets', async () => {
    const cb = page.getByRole('checkbox', { name: 'Keep this session in this browser' }).first();
    if (await cb.isDisabled()) return { pass: false, detail: 'checkbox is disabled (storage unavailable?)' };
    const before = await page.evaluate(() => localStorage.getItem('tessera.session/1'));
    await cb.check();
    await page.waitForFunction(() => localStorage.getItem('tessera.session/1') !== null, null, { timeout: 8000 });
    const schema = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('tessera.session/1') ?? 'null')?.schema ?? null;
      } catch {
        return null;
      }
    });
    await clickButton(page, 'Forget saved session');
    await page.waitForFunction(() => localStorage.getItem('tessera.session/1') === null, null, { timeout: 8000 });
    return { pass: before === null && schema === 'tessera.session/1', detail: `nothing stored before opt-in: ${before === null}; saved schema ${schema}; forgotten afterwards` };
  });

  // 0.2: dark scheme and print layout (emulated media, same page, same CSP).
  await step('dark scheme screenshot', async () => {
    const light = await effectiveBackground(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await settle(page);
    const dark = await effectiveBackground(page);
    await page.screenshot({ path: path.join(out, '08-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await settle(page);
    return { pass: Boolean(dark) && dark !== light, detail: `light ${light} → dark ${dark}` };
  });
  await step('print screenshot', async () => {
    await page.emulateMedia({ media: 'print' });
    await settle(page);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.profile__actions');
      if (!el) return { found: false };
      return { found: true, display: getComputedStyle(el).display, rects: el.getClientRects().length };
    });
    await page.screenshot({ path: path.join(out, '09-print.png'), fullPage: true });
    await page.emulateMedia({ media: null });
    await settle(page);
    const hidden = info.found && (info.display === 'none' || info.rects === 0);
    return { pass: hidden, detail: info.found ? `.profile__actions display ${info.display}, client rects ${info.rects}` : '.profile__actions not found' };
  });

  await step('no page/console errors', async () => ({ pass: bag.errors.length === 0, detail: bag.errors.slice(0, 5).join(' | ') }));
  await step('no failed requests', async () => ({ pass: bag.failedRequests.length === 0, detail: bag.failedRequests.slice(0, 5).join(' | ') }));
  cspViolations = await page.evaluate(() => window.__cspViolations ?? []);
  await ctx.close();

  // Mobile viewport with a deep link.
  const mobile = await browser.newContext({ viewport: { width: 375, height: 800 } });
  mobile.setDefaultTimeout(15000);
  const mp = await mobile.newPage();
  await mp.addInitScript(cspProbe);
  instrument(mp, mobileBag);
  await mp.goto(new URL('#/PR.DS-11', base).href, { waitUntil: 'networkidle' });
  await mp.screenshot({ path: path.join(out, '07-mobile.png'), fullPage: true });
  await step('mobile no horizontal overflow', async () => {
    const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
    return { pass: sw <= 375, detail: `scrollWidth ${sw}` };
  });
  mobileCspViolations = await mp.evaluate(() => window.__cspViolations ?? []);
  await mobile.close();

  // CSP, origin and header assertions (both pages).
  await step('no CSP violations', async () => {
    const violations = [...cspViolations, ...mobileCspViolations];
    const consoleLines = [...bag.cspConsole, ...mobileBag.cspConsole];
    const detail = [...violations.map((v) => `${v.directive} blocked ${v.blocked}${v.line ? ` (line ${v.line})` : ''}`), ...consoleLines].slice(0, 5).join(' | ');
    return { pass: violations.length === 0 && consoleLines.length === 0, detail: detail || 'no securitypolicyviolation events, no CSP console refusals' };
  });
  await step('no foreign requests', async () => {
    const foreign = [...bag.foreignRequests, ...mobileBag.foreignRequests];
    return { pass: foreign.length === 0, detail: foreign.slice(0, 5).join(' | ') || `every request targeted ${servedOrigin}` };
  });
  await step('index and asset headers', async () => {
    const problems = [];
    const idx = bag.responses.index;
    const h = idx?.headers ?? {};
    if (!idx) problems.push('no response for /');
    if (h['content-security-policy'] !== expectedCsp) problems.push(`index CSP ${h['content-security-policy'] === undefined ? 'missing' : 'differs from vercel.json'}`);
    if (h['x-content-type-options'] !== 'nosniff') problems.push(`index X-Content-Type-Options ${h['x-content-type-options'] ?? 'missing'}`);
    if (h['x-frame-options'] !== 'DENY') problems.push(`index X-Frame-Options ${h['x-frame-options'] ?? 'missing'}`);
    if (h['referrer-policy'] !== 'no-referrer') problems.push(`index Referrer-Policy ${h['referrer-policy'] ?? 'missing'}`);
    if (!h['strict-transport-security']) problems.push('index Strict-Transport-Security missing');
    if (h['cache-control'] !== 'no-cache') problems.push(`index Cache-Control ${h['cache-control'] ?? 'missing'}`);
    for (const [kind, type] of [
      ['js', 'text/javascript'],
      ['css', 'text/css'],
    ]) {
      const r = bag.responses[kind];
      if (!r) {
        problems.push(`no /assets/*.${kind} response observed`);
        continue;
      }
      if (!(r.headers['content-type'] ?? '').startsWith(type)) problems.push(`${kind} Content-Type ${r.headers['content-type'] ?? 'missing'}`);
      if (r.headers['content-security-policy'] !== expectedCsp) problems.push(`${kind} CSP ${r.headers['content-security-policy'] === undefined ? 'missing' : 'differs'}`);
      if (!(r.headers['cache-control'] ?? '').includes('immutable')) problems.push(`${kind} Cache-Control ${r.headers['cache-control'] ?? 'missing'}`);
    }
    const w = bag.responses.woff2;
    if (!w) problems.push('no /assets/*.woff2 response observed');
    else {
      if (w.status !== 200) problems.push(`woff2 status ${w.status}`);
      if (w.headers['content-type'] !== 'font/woff2') problems.push(`woff2 Content-Type ${w.headers['content-type'] ?? 'missing'}`);
    }
    return { pass: problems.length === 0, detail: problems.join('; ') || 'index, JS, CSS and woff2 responses carry the vercel.json headers' };
  });
} catch (err) {
  record('workflow completed', false, `unexpected error: ${err?.message ?? err}`);
} finally {
  await browser.close();
}

await fs.writeFile(path.join(out, 'headers.json'), JSON.stringify({ servedOrigin, expectedCsp, ...bag.responses }, null, 2) + '\n');
await fs.writeFile(path.join(out, 'workflow-results.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.filter((r) => !r.pass);
console.log(`workflow: ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — failed: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
