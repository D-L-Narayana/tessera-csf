#!/usr/bin/env node
// Build-output checks for dist/ (node built-ins only). Run after `npm run build`:
//
//   node qa/check-dist.mjs [--dist dist] [--budget-kb 120] [--config vercel.json]
//
// FAIL (exit 1) when dist/index.html contains an inline <script> (no src), a <style> element, a style= attribute,
// an inline event handler (on*=) or a <base> element; when an asset URL in index.html is not relative (./…) or
// points at a file that does not exist; when the gzip total of dist/assets/*.js exceeds BUDGET_JS_GZIP_KB
// (env, default 120); when dist/THIRD_PARTY_LICENSES.txt is missing; when dist/schemas/*.json fail JSON.parse;
// when a relative url() in a CSS asset points at a missing file; or when a data: URL in CSS would be blocked by
// the production Content-Security-Policy in vercel.json.
// INFO (never fails): the data: URLs found in dist/assets/*.css, counted per MIME type.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const DEFAULT_BUDGET_KB = 120;
// <link rel=…> values that are documents or metadata, not fetched assets.
const NON_ASSET_RELS = new Set(['canonical', 'alternate', 'author', 'license', 'help', 'search', 'me', 'next', 'prev', 'bookmark', 'tag', 'external', 'nofollow', 'noopener', 'noreferrer']);
const ASSET_ATTRS = {
  script: ['src'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  iframe: ['src'],
  embed: ['src'],
  object: ['data'],
};

const USAGE = `usage: node qa/check-dist.mjs [--dist dist] [--budget-kb ${DEFAULT_BUDGET_KB}] [--config vercel.json]
Checks a built dist/ directory; exits 1 when any check fails. BUDGET_JS_GZIP_KB overrides the default budget.`;

// ---------- HTML scanning ----------

function parseAttrs(text) {
  const attrs = [];
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(text))) attrs.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' });
  return attrs;
}

/** Start tags of an HTML document as { name, attrs[], raw }, comments removed, quoted ">" respected. */
export function parseTags(html) {
  const src = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const tags = [];
  let i = 0;
  while ((i = src.indexOf('<', i)) !== -1) {
    const m = /^<([a-zA-Z][\w:-]*)/.exec(src.slice(i, i + 64));
    if (!m) {
      i++;
      continue;
    }
    let j = i + m[0].length;
    let quote = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    tags.push({ name: m[1].toLowerCase(), attrs: parseAttrs(src.slice(i + m[0].length, j)), raw: src.slice(i, j + 1) });
    i = j + 1;
  }
  return tags;
}

/** URLs the browser would fetch as sub-resources: scripts, stylesheets/preloads/icons/manifests, media. */
export function assetUrls(tags) {
  const out = [];
  for (const t of tags) {
    if (t.name === 'link') {
      const rel = (t.attrs.find((a) => a.name === 'rel')?.value ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      if (rel.length && rel.every((r) => NON_ASSET_RELS.has(r))) continue;
      const href = t.attrs.find((a) => a.name === 'href');
      if (href) out.push({ where: `link[rel=${rel.join(' ') || '?'}] href`, url: href.value.trim() });
      continue;
    }
    const names = ASSET_ATTRS[t.name];
    if (!names) continue;
    for (const a of t.attrs) {
      if (!names.includes(a.name)) continue;
      const values = a.name === 'srcset' ? a.value.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) : [a.value.trim()];
      for (const v of values) out.push({ where: `${t.name} ${a.name}`, url: v });
    }
  }
  return out;
}

const snippet = (raw) => (raw.length > 90 ? raw.slice(0, 87) + '...' : raw);

/** Findings for dist/index.html: [{ check, ok, detail }]. */
export function checkIndexHtml(html) {
  const tags = parseTags(html);
  const findings = [];
  const add = (check, bad, okDetail) => findings.push({ check, ok: bad.length === 0, detail: bad.length ? bad.join('; ') : okDetail });
  const scripts = tags.filter((t) => t.name === 'script');
  add('no inline <script>', scripts.filter((t) => !t.attrs.some((a) => a.name === 'src')).map((t) => snippet(t.raw)), `${scripts.length} script tag(s), all external`);
  add('no <style> element', tags.filter((t) => t.name === 'style').map((t) => snippet(t.raw)), 'none');
  add('no style= attribute', tags.filter((t) => t.attrs.some((a) => a.name === 'style')).map((t) => snippet(t.raw)), 'none');
  add('no inline event handlers', tags.filter((t) => t.attrs.some((a) => /^on[a-z]+$/.test(a.name))).map((t) => snippet(t.raw)), 'none');
  const urls = assetUrls(tags);
  add('asset URLs relative', urls.filter((u) => !u.url.startsWith('./')).map((u) => `${u.where}=${u.url}`), `${urls.length} asset URL(s), all start with ./`);
  add('no <base> element', tags.filter((t) => t.name === 'base').map((t) => snippet(t.raw)), 'none');
  return findings;
}

// ---------- CSS and CSP helpers ----------

/** data: URLs inside url(...) of a stylesheet, counted per MIME type. */
export function findDataUrls(css) {
  const counts = new Map();
  const re = /url\(\s*["']?data:([^;,"')\s]*)/gi;
  let m;
  while ((m = re.exec(String(css)))) {
    const mime = (m[1] || 'unknown').toLowerCase();
    counts.set(mime, (counts.get(mime) ?? 0) + 1);
  }
  return [...counts].map(([mime, count]) => ({ mime, count })).sort((a, b) => a.mime.localeCompare(b.mime));
}

export function parseCsp(csp) {
  const map = new Map();
  for (const part of String(csp ?? '').split(';')) {
    const [name, ...tokens] = part.trim().split(/\s+/).filter(Boolean);
    if (name && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), tokens);
  }
  return map;
}

/**
 * Does `csp` allow `sourceToken` (e.g. "data:", "'self'", "https://x.example") for `directive`, falling back to
 * default-src when the directive is absent? "*" matches network schemes only, never data:/blob:/filesystem:.
 */
export function cspAllows(csp, directive, sourceToken) {
  const map = parseCsp(csp);
  const tokens = map.get(String(directive).toLowerCase()) ?? map.get('default-src');
  if (!tokens) return true;
  const want = String(sourceToken).toLowerCase();
  const lower = tokens.map((t) => t.toLowerCase());
  if (lower.includes(want)) return true;
  const schemeOnly = /^[a-z][a-z0-9+.-]*:$/.test(want);
  if (schemeOnly) return false;
  if (lower.includes('*')) return true;
  const scheme = /^[a-z][a-z0-9+.-]*:/.exec(want)?.[0];
  return Boolean(scheme && lower.includes(scheme));
}

export function directiveForMime(mime) {
  const m = String(mime).toLowerCase();
  if (m.startsWith('image/')) return 'img-src';
  if (m.startsWith('font/') || m.startsWith('application/font') || m.startsWith('application/x-font') || m === 'application/vnd.ms-fontobject') return 'font-src';
  if (m === 'text/css') return 'style-src';
  if (m === 'text/javascript' || m === 'application/javascript') return 'script-src';
  if (m.startsWith('audio/') || m.startsWith('video/')) return 'media-src';
  return 'default-src';
}

// ---------- dist checks ----------

function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

/** Run every check against a dist directory. Returns { ok, failures, rows }. */
export function runChecks({ distDir = 'dist', budgetKb = DEFAULT_BUDGET_KB, csp } = {}) {
  const root = path.resolve(distDir);
  const rows = [];
  const row = (check, status, detail) => rows.push({ check, status, detail });
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const shownRoot = path.relative(process.cwd(), root) || '.';

  const indexPath = path.join(root, 'index.html');
  let indexHtml = null;
  if (fs.existsSync(indexPath)) {
    indexHtml = fs.readFileSync(indexPath, 'utf8');
    row('index.html present', 'PASS', `${indexHtml.length} characters`);
  } else {
    row('index.html present', 'FAIL', `${shownRoot}/index.html not found — run "npm run build" first`);
  }
  if (indexHtml !== null) {
    for (const f of checkIndexHtml(indexHtml)) row(f.check, f.ok ? 'PASS' : 'FAIL', f.detail);
    const refs = assetUrls(parseTags(indexHtml)).filter((u) => u.url.startsWith('./'));
    const missing = refs.filter((u) => !fs.existsSync(path.join(root, u.url.split(/[?#]/)[0])));
    row('referenced assets exist', missing.length ? 'FAIL' : 'PASS', missing.length ? `missing: ${missing.map((u) => u.url).join(', ')}` : `${refs.length} reference(s) resolve inside dist`);
  }

  const assetFiles = walk(path.join(root, 'assets'));
  const jsFiles = assetFiles.filter((f) => /\.m?js$/i.test(f));
  if (!jsFiles.length) {
    row('JS gzip budget', 'FAIL', 'no JavaScript files under dist/assets');
  } else {
    const perFile = jsFiles.map((f) => ({ file: rel(f), gz: zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length }));
    const total = perFile.reduce((s, f) => s + f.gz, 0);
    const largest = perFile.slice().sort((a, b) => b.gz - a.gz)[0];
    row('JS gzip budget', total <= budgetKb * 1024 ? 'PASS' : 'FAIL', `${kb(total)} kB gzip across ${jsFiles.length} file(s); budget ${budgetKb} kB; largest ${largest.file} ${kb(largest.gz)} kB`);
  }

  const licence = path.join(root, 'THIRD_PARTY_LICENSES.txt');
  row('THIRD_PARTY_LICENSES.txt', fs.existsSync(licence) ? 'PASS' : 'FAIL', fs.existsSync(licence) ? `${fs.statSync(licence).size} bytes` : 'missing from dist (expected to be copied from public/)');

  const schemasDir = path.join(root, 'schemas');
  if (!fs.existsSync(schemasDir)) {
    row('schemas parse', 'WARN', 'dist/schemas not present — skipped');
  } else {
    const files = walk(schemasDir).filter((f) => f.endsWith('.json'));
    const bad = [];
    for (const f of files) {
      try {
        const v = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!v || typeof v !== 'object') bad.push(`${rel(f)}: not a JSON object`);
      } catch (err) {
        bad.push(`${rel(f)}: ${err.message}`);
      }
    }
    if (!files.length) row('schemas parse', 'WARN', 'dist/schemas contains no .json files');
    else row('schemas parse', bad.length ? 'FAIL' : 'PASS', bad.length ? bad.join('; ') : files.map(rel).join(', '));
  }

  const cssFiles = assetFiles.filter((f) => /\.css$/i.test(f));
  const missingUrls = [];
  let urlCount = 0;
  const dataTotals = new Map();
  for (const f of cssFiles) {
    const css = fs.readFileSync(f, 'utf8');
    for (const { mime, count } of findDataUrls(css)) dataTotals.set(mime, (dataTotals.get(mime) ?? 0) + count);
    const re = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
    let m;
    while ((m = re.exec(css))) {
      const u = m[2].trim();
      if (/^(data:|blob:|https?:|\/\/|#)/i.test(u)) continue;
      urlCount++;
      const clean = u.split(/[?#]/)[0];
      const target = clean.startsWith('/') ? path.join(root, clean) : path.resolve(path.dirname(f), clean);
      if (!fs.existsSync(target)) missingUrls.push(`${rel(f)} → ${u}`);
    }
  }
  row('CSS url() targets exist', missingUrls.length ? 'FAIL' : 'PASS', missingUrls.length ? missingUrls.join('; ') : `${urlCount} relative url() reference(s) across ${cssFiles.length} stylesheet(s) resolve`);

  const dataList = [...dataTotals].map(([mime, count]) => ({ mime, count })).sort((a, b) => a.mime.localeCompare(b.mime));
  row('data: URLs in CSS', 'INFO', dataList.length ? dataList.map((d) => `${d.mime} ×${d.count}`).join(', ') : 'none');
  if (!csp) row('data: URLs vs production CSP', 'WARN', 'no Content-Security-Policy supplied — skipped');
  else if (!dataList.length) row('data: URLs vs production CSP', 'PASS', 'no data: URLs to check');
  else {
    const blocked = dataList.filter((d) => !cspAllows(csp, directiveForMime(d.mime), 'data:')).map((d) => `${d.mime} would be blocked (${directiveForMime(d.mime)} lacks data:)`);
    row('data: URLs vs production CSP', blocked.length ? 'FAIL' : 'PASS', blocked.length ? blocked.join('; ') : 'every data: MIME type is permitted by the CSP');
  }

  const failures = rows.filter((r) => r.status === 'FAIL').map((r) => `${r.check}: ${r.detail}`);
  return { ok: failures.length === 0, failures, rows };
}

// ---------- CLI ----------

function cspFromConfig(configPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const rule of cfg.headers ?? []) {
      const h = (rule.headers ?? []).find((x) => String(x.key).toLowerCase() === 'content-security-policy');
      if (h) return h.value;
    }
  } catch {
    /* no config → the CSP check is reported as WARN */
  }
  return undefined;
}

function parseArgs(argv) {
  const opts = { dist: 'dist', budgetKb: Number(process.env.BUDGET_JS_GZIP_KB ?? DEFAULT_BUDGET_KB), config: 'vercel.json', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === '--dist') opts.dist = next();
    else if (arg === '--budget-kb') opts.budgetKb = Number(next());
    else if (arg === '--config') opts.config = next();
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isFinite(opts.budgetKb) || opts.budgetKb <= 0) throw new Error('budget must be a positive number of kB');
  return opts;
}

function printTable(rows) {
  const w1 = Math.max(6, ...rows.map((r) => r.status.length));
  const w2 = Math.max(5, ...rows.map((r) => r.check.length));
  console.log(`${'STATUS'.padEnd(w1)}  ${'CHECK'.padEnd(w2)}  DETAIL`);
  for (const r of rows) console.log(`${r.status.padEnd(w1)}  ${r.check.padEnd(w2)}  ${r.detail}`);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`check-dist: ${err.message}\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result = runChecks({ distDir: opts.dist, budgetKb: opts.budgetKb, csp: cspFromConfig(path.resolve(opts.config)) });
  console.log(`check-dist: ${path.relative(process.cwd(), path.resolve(opts.dist)) || '.'} (JS gzip budget ${opts.budgetKb} kB)`);
  printTable(result.rows);
  if (result.ok) {
    console.log('check-dist: clean');
    process.exit(0);
  }
  console.error(`check-dist: ${result.failures.length} failure(s)`);
  for (const f of result.failures) console.error(`  - ${f}`);
  process.exit(1);
}
