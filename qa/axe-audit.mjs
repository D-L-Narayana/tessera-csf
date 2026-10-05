#!/usr/bin/env node
// Accessibility audit with axe-core (WCAG 2.0/2.1 A + AA tags) at 1440 / 768 / 375 for one or more paths.
//
//   node qa/axe-audit.mjs [--url http://127.0.0.1:6120/] [--out qa/audit] [--paths /,/#/RC.CO-03] [--dark]
//                         [--axe-source <path to axe-core/axe.min.js>]
//
// Needs the Playwright library plus ONE of: @axe-core/playwright (loaded with a dynamic import), or a local
// copy of axe-core's axe.min.js given with --axe-source (read with fs and injected per page). Neither is a repo
// dependency; see qa/README.md. Exit codes: 0 no violations, 1 violations / page errors / horizontal overflow,
// 2 the libraries or the browser are unavailable.
//
// Instrumentation context: axe has to inject its own script, so each page is opened in a browser context created
// with bypassCSP: true. The server still sends the production Content-Security-Policy untouched — only this
// audit context ignores it, and every entry in the output is labelled with that fact. CSP enforcement itself is
// measured by qa/workflow.mjs, which runs without the bypass.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const INSTALL_HINT = "Install playwright (and @axe-core/playwright) in a scratch directory and point NODE_PATH at its node_modules; browsers come from Playwright's default cache or PLAYWRIGHT_BROWSERS_PATH";
const CONTEXT_LABEL = 'axe-instrumentation (bypassCSP: true; application CSP unchanged on the server)';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 800 },
];

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

function pickAxeBuilder(mod) {
  const candidates = [mod?.AxeBuilder, mod?.default?.AxeBuilder, mod?.default?.default, mod?.default];
  return candidates.find((c) => typeof c === 'function') ?? null;
}

// ---------- arguments ----------

function parseArgs(argv) {
  const opts = { url: 'http://127.0.0.1:6120/', out: 'qa/audit', paths: ['/', '/#/RC.CO-03'], dark: false, axeSource: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === '--url') opts.url = next();
    else if (arg === '--out') opts.out = next();
    else if (arg === '--paths') opts.paths = next().split(',').map((p) => p.trim()).filter(Boolean);
    else if (arg === '--dark') opts.dark = true;
    else if (arg === '--axe-source') opts.axeSource = next();
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.paths.length) throw new Error('--paths needs at least one path');
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`axe-audit: ${err.message}`);
  process.exit(2);
}
if (opts.help) {
  console.log('usage: node qa/axe-audit.mjs [--url http://127.0.0.1:6120/] [--out qa/audit] [--paths /,/#/RC.CO-03] [--dark] [--axe-source <axe.min.js>]');
  process.exit(0);
}
const base = new URL(opts.url);
const out = path.resolve(opts.out);
await fs.mkdir(out, { recursive: true });

const chromium = pickChromium(await loadOptional('playwright'));
if (!chromium) {
  console.error(`axe-audit: the Playwright library could not be loaded. ${INSTALL_HINT}`);
  process.exit(2);
}

let engine = null;
if (opts.axeSource) {
  let source;
  try {
    source = await fs.readFile(path.resolve(opts.axeSource), 'utf8');
  } catch (err) {
    console.error(`axe-audit: cannot read --axe-source ${opts.axeSource}: ${err.message}`);
    process.exit(2);
  }
  if (!/axe/.test(source.slice(0, 2000))) {
    console.error(`axe-audit: ${opts.axeSource} does not look like axe-core's axe.min.js`);
    process.exit(2);
  }
  engine = { kind: 'source', label: 'axe-source: ' + path.basename(opts.axeSource), source };
} else {
  const AxeBuilder = pickAxeBuilder(await loadOptional('@axe-core/playwright'));
  if (AxeBuilder) engine = { kind: 'builder', label: '@axe-core/playwright', AxeBuilder };
}
if (!engine) {
  console.error(`axe-audit: neither @axe-core/playwright nor --axe-source is available. ${INSTALL_HINT}. Alternatively pass --axe-source <path to axe-core/axe.min.js> (for example from a scratch install's node_modules/axe-core/axe.min.js).`);
  process.exit(2);
}

// ---------- page inspection ----------

function collectLayout() {
  const text = (el) => (el.textContent ?? '').trim();
  return {
    title: document.title,
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headings: [...document.querySelectorAll('h1, h2')].map(text),
    primaryControls: [...document.querySelectorAll('a, button, input, select, textarea')].slice(0, 200).map((el) => ({ tag: el.tagName, text: text(el).slice(0, 100), type: el.getAttribute('type'), id: el.id })),
    overflowing: [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
      })
      .slice(0, 40)
      .map((el) => ({ tag: el.tagName, class: el.getAttribute('class') ?? '' })),
  };
}

async function runAxe(page) {
  if (engine.kind === 'builder') {
    const r = await new engine.AxeBuilder({ page }).withTags(TAGS).analyze();
    return { violations: r.violations ?? [], incomplete: r.incomplete ?? [], version: r.testEngine?.version ?? null };
  }
  await page.addScriptTag({ content: engine.source });
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return { violations: r.violations, incomplete: r.incomplete, version: window.axe.version };
  }, TAGS);
}

const slug = (p) => p.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const urlPath = (u) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

// ---------- run ----------

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  console.error(`axe-audit: could not launch Chromium (${err?.message?.split('\n')[0]}). ${INSTALL_HINT}`);
  process.exit(2);
}

const entries = [];
let failures = 0;
try {
  for (const p of opts.paths) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, bypassCSP: true, colorScheme: opts.dark ? 'dark' : 'light' });
      ctx.setDefaultTimeout(30000);
      const page = await ctx.newPage();
      const errors = [];
      const failedRequests = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('requestfailed', (r) => {
        if (/^(data|blob|about):/.test(r.url())) return;
        const reason = r.failure()?.errorText ?? 'failed';
        if (reason !== 'net::ERR_ABORTED') failedRequests.push(`${reason} ${urlPath(r.url())}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && urlPath(r.url()) !== '/favicon.ico') failedRequests.push(`HTTP ${r.status()} ${urlPath(r.url())}`);
      });
      const target = new URL(p, base).href;
      const name = `${vp.name}${p === '/' ? '' : '-' + slug(p)}${opts.dark ? '-dark' : ''}`;
      let status = 0;
      let layout = null;
      let axe = { violations: [], incomplete: [], version: null };
      try {
        const response = await page.goto(target, { waitUntil: 'networkidle' });
        status = response?.status() ?? 0;
        await page.evaluate(() => document.fonts.ready.then(() => true));
        layout = await page.evaluate(collectLayout);
        await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
        axe = await runAxe(page);
      } catch (err) {
        errors.push(`audit error: ${err?.message ?? err}`);
      }
      const violations = axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes?.length ?? 0,
        targets: (v.nodes ?? []).slice(0, 5).map((n) => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target))),
      }));
      const incompleteChecks = axe.incomplete.map((i) => ({ id: i.id, impact: i.impact ?? null }));
      const overflow = Boolean(layout && layout.scrollWidth > layout.viewport);
      const entry = {
        name,
        status,
        url: target,
        errors,
        failedRequests,
        layout,
        violations,
        incompleteChecks,
        path: p,
        colorScheme: opts.dark ? 'dark' : 'light',
        context: CONTEXT_LABEL,
        engine: engine.label,
        axeVersion: axe.version ?? null,
        tags: TAGS,
        horizontalOverflow: overflow,
      };
      entries.push(entry);
      const problems = violations.length + errors.length + (overflow ? 1 : 0);
      failures += problems;
      console.log(`${problems ? 'FAIL' : 'PASS'}  ${name}: ${violations.length} violation(s), ${incompleteChecks.length} incomplete, ${errors.length} page error(s), ${failedRequests.length} failed request(s), scrollWidth ${layout?.scrollWidth ?? '?'}/${vp.width}${overflow ? ' OVERFLOW' : ''}`);
      for (const v of violations) console.log(`      ${v.impact ?? 'n/a'} ${v.id}: ${v.help} (${v.nodes} node(s)) ${v.targets.join(' ; ')}`);
      for (const e of errors) console.log(`      error: ${e}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(out, 'browser-audit.json'), JSON.stringify(entries, null, 2) + '\n');
console.log(`axe-audit: ${entries.length} page(s) audited with ${engine.label}${entries[0]?.axeVersion ? ` (axe-core ${entries[0].axeVersion})` : ''} in the ${CONTEXT_LABEL} context; ${failures ? `${failures} problem(s)` : 'no violations, errors or overflow'}`);
process.exit(failures ? 1 : 0);
