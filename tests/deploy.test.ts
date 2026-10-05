import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { contentTypeFor, handleRequest, headersFor, loadVercelConfig, resolveRequest, sourceToRegExp, type VercelConfig } from '../qa/serve-dist.mjs';
import { checkIndexHtml, cspAllows, findDataUrls, runChecks } from '../qa/check-dist.mjs';

// Deployment and QA tooling contract: the production headers in vercel.json, the local server that
// reproduces them for browser QA, the build-output checker, the CI workflow and the portability of qa/.

const root = process.cwd();
const config: VercelConfig = loadVercelConfig(resolve(root, 'vercel.json'));
const rules = config.headers ?? [];
const rule = (source: string) => rules.find((r) => r.source === source);
const value = (source: string, key: string) => rule(source)?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
const csp = value('/(.*)', 'Content-Security-Policy') ?? '';
const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(name + ' ')) ?? '';
const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262';
const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020';
// Assembled at runtime so that this file itself never contains the strings the portability gate greps for.
const PRIVATE_HOME = ['/ho', 'me/'].join('');
const TOOLS_PLACEHOLDER = ['<', 'tools', '>'].join('');
const CHROMIUM_ENV = ['CHROMIUM_', 'EXECUTABLE_PATH'].join('');

const CLEAN_INDEX = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '    <meta name="description" content="Browser-local evidence mapper. Educational prototype on synthetic data; not a certification." />',
  '    <meta name="color-scheme" content="light dark" />',
  '    <title>Tessera — test page</title>',
  '    <script type="module" crossorigin src="./assets/index-abc123.js"></script>',
  '    <link rel="stylesheet" crossorigin href="./assets/index-abc123.css">',
  '  </head>',
  '  <body>',
  '    <div id="root"></div>',
  '  </body>',
  '</html>',
].join('\n');

interface FakeResponse {
  statusCode: number;
  body: Buffer;
  ended: boolean;
  setHeader(name: string, value: string | number): void;
  end(chunk?: Buffer | string): void;
  header(name: string): string | undefined;
}

function fakeRes(): FakeResponse {
  const headers = new Map<string, string>();
  const r: FakeResponse = {
    statusCode: 200,
    body: Buffer.alloc(0),
    ended: false,
    setHeader(name, v) {
      headers.set(name.toLowerCase(), String(v));
    },
    end(chunk) {
      if (chunk !== undefined) r.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      r.ended = true;
    },
    header(name) {
      return headers.get(name.toLowerCase());
    },
  };
  return r;
}

async function request(distDir: string, url: string, method = 'GET'): Promise<FakeResponse> {
  const res = fakeRes();
  await handleRequest({ method, url }, res, { distDir, config });
  return res;
}

interface DistOptions {
  index?: string;
  licence?: boolean;
  schema?: string | null;
  css?: string;
  js?: string;
}

const tempDirs: string[] = [];
function makeDist(opts: DistOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-dist-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), opts.index ?? CLEAN_INDEX);
  writeFileSync(join(dir, 'about.html'), '<!doctype html><title>about</title><p>about</p>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), opts.js ?? 'console.log("tessera test bundle");\n');
  writeFileSync(join(dir, 'assets', 'index-abc123.css'), opts.css ?? 'h1{font-family:Fraunces}\n@font-face{font-family:Fraunces;src:url(./fraunces-latin-600-normal-x1.woff2) format("woff2")}\n');
  writeFileSync(join(dir, 'assets', 'fraunces-latin-600-normal-x1.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]));
  if (opts.licence !== false) writeFileSync(join(dir, 'THIRD_PARTY_LICENSES.txt'), 'Fraunces — OFL-1.1\n');
  if (opts.schema !== null) {
    mkdirSync(join(dir, 'schemas'));
    writeFileSync(join(dir, 'schemas', 'tessera.pack.v1.schema.json'), opts.schema ?? '{"$id":"https://example.invalid/tessera.pack.v1.schema.json","type":"object"}');
  }
  return dir;
}

afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

describe('vercel.json production headers', () => {
  it('keeps the schema reference and cleanUrls', () => {
    expect(config.$schema).toBe('https://openapi.vercel.sh/vercel.json');
    expect(config.cleanUrls).toBe(true);
    expect(rule('/(.*)')).toBeDefined();
  });

  it('CSP locks scripts and styles to self without unsafe-inline or unsafe-eval anywhere', () => {
    expect(directive('default-src')).toBe("default-src 'none'");
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('style-src')).toBe("style-src 'self'");
    const everyValue = rules.flatMap((r) => r.headers.map((h) => h.value)).join('\n');
    expect(everyValue).not.toContain('unsafe-inline');
    expect(everyValue).not.toContain('unsafe-eval');
  });

  it('CSP denies framing, plugins, base targets and form submission', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'none'");
    expect(directive('form-action')).toBe("form-action 'none'");
  });

  it('CSP keeps the image, font, connect and manifest sources the app relies on', () => {
    expect(directive('img-src')).toBe("img-src 'self' data: blob:");
    expect(directive('font-src')).toBe("font-src 'self'");
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(directive('manifest-src')).toBe("manifest-src 'self'");
  });

  it('global rule keeps nosniff, DENY, no-referrer, Permissions-Policy, COOP and CORP', () => {
    expect(value('/(.*)', 'X-Content-Type-Options')).toBe('nosniff');
    expect(value('/(.*)', 'X-Frame-Options')).toBe('DENY');
    expect(value('/(.*)', 'Referrer-Policy')).toBe('no-referrer');
    expect(value('/(.*)', 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(value('/(.*)', 'Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(value('/(.*)', 'Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('global rule adds HSTS with a two-year max-age and includeSubDomains', () => {
    const hsts = value('/(.*)', 'Strict-Transport-Security') ?? '';
    const m = /max-age=(\d+)/.exec(hsts);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(63072000);
    expect(hsts).toContain('includeSubDomains');
  });

  it('hashed assets are cached immutably for a year', () => {
    expect(value('/assets/(.*)', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('the document is never cached (both / and /index.html)', () => {
    expect(value('/index.html', 'Cache-Control')).toBe('no-cache');
    expect(value('/', 'Cache-Control')).toBe('no-cache');
  });

  it('the global rule comes first so the specific cache rules win on conflict', () => {
    const order = rules.map((r) => r.source);
    expect(order.indexOf('/(.*)')).toBe(0);
    expect(order.indexOf('/assets/(.*)')).toBeGreaterThan(0);
    expect(order.indexOf('/index.html')).toBeGreaterThan(0);
    expect(order.indexOf('/')).toBeGreaterThan(0);
  });
});

describe('qa/serve-dist.mjs header resolution', () => {
  it('sourceToRegExp follows Vercel path semantics', () => {
    const all = sourceToRegExp('/(.*)');
    expect(all.test('/')).toBe(true);
    expect(all.test('/assets/index-abc.js')).toBe(true);
    const assets = sourceToRegExp('/assets/(.*)');
    expect(assets.test('/assets/index-abc.js')).toBe(true);
    expect(assets.test('/assets/fonts/a.woff2')).toBe(true);
    expect(assets.test('/assetsx')).toBe(false);
    expect(assets.test('/')).toBe(false);
    const index = sourceToRegExp('/index.html');
    expect(index.test('/index.html')).toBe(true);
    expect(index.test('/indexXhtml')).toBe(false);
    expect(index.test('/sub/index.html')).toBe(false);
    const slash = sourceToRegExp('/');
    expect(slash.test('/')).toBe(true);
    expect(slash.test('/x')).toBe(false);
  });

  it('headersFor("/index.html") returns the production CSP, no-cache and the hardening headers', () => {
    const h = headersFor('/index.html', config);
    expect(h['Content-Security-Policy']).toBe(csp);
    expect(h['Cache-Control']).toBe('no-cache');
    expect(h['Strict-Transport-Security']).toContain('max-age=');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('no-referrer');
  });

  it('headersFor("/assets/x.js") returns immutable caching together with the CSP', () => {
    const h = headersFor('/assets/x.js', config);
    expect(h['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(h['Content-Security-Policy']).toBe(csp);
    expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('headersFor("/") is no-cache and later rules override earlier ones for the same key', () => {
    expect(headersFor('/', config)['Cache-Control']).toBe('no-cache');
    const custom: VercelConfig = {
      headers: [
        { source: '/(.*)', headers: [{ key: 'X-Test', value: 'global' }, { key: 'X-Keep', value: 'kept' }] },
        { source: '/docs/(.*)', headers: [{ key: 'x-test', value: 'docs' }] },
        { source: '/other', headers: [{ key: 'X-Test', value: 'other' }] },
      ],
    };
    const h = headersFor('/docs/a', custom);
    expect(h['X-Keep']).toBe('kept');
    expect(Object.entries(h).find(([k]) => k.toLowerCase() === 'x-test')?.[1]).toBe('docs');
    expect(Object.keys(h).filter((k) => k.toLowerCase() === 'x-test')).toHaveLength(1);
    expect(headersFor('/elsewhere', custom)['X-Test']).toBe('global');
  });

  it('contentTypeFor maps every build-output type', () => {
    expect(contentTypeFor('/assets/font.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/assets/font.woff')).toBe('font/woff');
    expect(contentTypeFor('/assets/index.js').startsWith('text/javascript')).toBe(true);
    expect(contentTypeFor('/assets/index.css').startsWith('text/css')).toBe(true);
    expect(contentTypeFor('/schemas/x.json').startsWith('application/json')).toBe(true);
    expect(contentTypeFor('/index.html').startsWith('text/html')).toBe(true);
    expect(contentTypeFor('/THIRD_PARTY_LICENSES.txt').startsWith('text/plain')).toBe(true);
    expect(contentTypeFor('/a.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('/a.png')).toBe('image/png');
    expect(contentTypeFor('/a.md').startsWith('text/markdown')).toBe(true);
    expect(contentTypeFor('/a.unknownext')).toBe('application/octet-stream');
  });
});

describe('qa/serve-dist.mjs request handling', () => {
  let dist = '';
  beforeAll(() => {
    dist = makeDist();
  });

  it('serves / as index.html with the document headers and HTML type', async () => {
    const res = await request(dist, '/');
    expect(res.statusCode).toBe(200);
    expect(res.header('content-type')?.startsWith('text/html')).toBe(true);
    expect(res.header('content-security-policy')).toBe(csp);
    expect(res.header('cache-control')).toBe('no-cache');
    expect(res.header('strict-transport-security')).toContain('max-age=');
    expect(Number(res.header('content-length'))).toBe(res.body.length);
    expect(res.body.toString('utf8')).toContain('<div id="root"></div>');
  });

  it('serves hashed assets with JavaScript/font MIME types, immutable caching and the CSP', async () => {
    const js = await request(dist, '/assets/index-abc123.js?v=1');
    expect(js.statusCode).toBe(200);
    expect(js.header('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.header('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.header('content-security-policy')).toBe(csp);
    const font = await request(dist, '/assets/fraunces-latin-600-normal-x1.woff2');
    expect(font.statusCode).toBe(200);
    expect(font.header('content-type')).toBe('font/woff2');
    expect(font.header('cache-control')).toContain('immutable');
    const css = await request(dist, '/assets/index-abc123.css');
    expect(css.header('content-type')).toBe('text/css; charset=utf-8');
  });

  it('applies cleanUrls: extensionless paths serve the html file and .html paths redirect', async () => {
    const about = await request(dist, '/about');
    expect(about.statusCode).toBe(200);
    expect(about.body.toString('utf8')).toContain('about');
    const redirect = await request(dist, '/about.html');
    expect(redirect.statusCode).toBe(308);
    expect(redirect.header('location')).toBe('/about');
    const index = await request(dist, '/index.html');
    expect(index.statusCode).toBe(308);
    expect(index.header('location')).toBe('/');
    expect(index.header('content-security-policy')).toBe(csp);
    expect(index.header('cache-control')).toBe('no-cache');
  });

  it('answers 404 with the security headers and never serves outside dist', async () => {
    const missing = await request(dist, '/missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.header('content-security-policy')).toBe(csp);
    expect(missing.header('x-frame-options')).toBe('DENY');
    for (const url of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/assets/../../package.json', '/..%2fpackage.json']) {
      const res = await request(dist, url);
      expect(res.statusCode, url).toBe(404);
    }
    expect(resolveRequest('/../../etc/passwd', dist).status).toBe(404);
    const ok = resolveRequest('/assets/index-abc123.js', dist);
    expect(ok.status).toBe(200);
    expect(ok.filePath?.startsWith(resolve(dist))).toBe(true);
  });

  it('supports HEAD with the same headers and no body', async () => {
    const res = await request(dist, '/', 'HEAD');
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(0);
    expect(Number(res.header('content-length'))).toBeGreaterThan(0);
    expect(res.header('content-security-policy')).toBe(csp);
    expect(res.ended).toBe(true);
  });

  it('rejects other methods but still sends the security headers', async () => {
    const res = await request(dist, '/', 'POST');
    expect(res.statusCode).toBe(405);
    expect(res.header('allow')).toContain('GET');
    expect(res.header('content-security-policy')).toBe(csp);
  });
});

describe('qa/check-dist.mjs build-output checks', () => {
  const failing = (html: string) => checkIndexHtml(html).filter((f) => !f.ok).map((f) => f.check);

  it('accepts a clean Vite-style index.html', () => {
    const findings = checkIndexHtml(CLEAN_INDEX);
    expect(findings.length).toBeGreaterThanOrEqual(5);
    expect(findings.every((f) => f.ok)).toBe(true);
  });

  it('rejects inline scripts, style elements, style attributes and inline event handlers', () => {
    expect(failing(CLEAN_INDEX.replace('</head>', '<script>window.x = 1</script></head>'))).toContain('no inline <script>');
    expect(failing(CLEAN_INDEX.replace('</head>', '<style>body{margin:0}</style></head>'))).toContain('no <style> element');
    expect(failing(CLEAN_INDEX.replace('<div id="root">', '<div id="root" style="margin:0">'))).toContain('no style= attribute');
    expect(failing(CLEAN_INDEX.replace('<div id="root">', '<div id="root" onclick="x()">'))).toContain('no inline event handlers');
    expect(failing(CLEAN_INDEX.replace('<body>', '<body onload="init()">'))).toContain('no inline event handlers');
  });

  it('rejects non-relative asset URLs, foreign resource hints and <base>', () => {
    expect(failing(CLEAN_INDEX.replace('src="./assets/index-abc123.js"', 'src="/assets/index-abc123.js"'))).toContain('asset URLs relative');
    expect(failing(CLEAN_INDEX.replace('href="./assets/index-abc123.css"', 'href="https://cdn.example/index.css"'))).toContain('asset URLs relative');
    expect(failing(CLEAN_INDEX.replace('</head>', '<link rel="preconnect" href="https://fonts.example"></head>'))).toContain('asset URLs relative');
    expect(failing(CLEAN_INDEX.replace('</head>', '<base href="https://example.invalid/"></head>'))).toContain('no <base> element');
    // A fragment link or a canonical link is not an asset URL.
    expect(failing(CLEAN_INDEX.replace('</head>', '<link rel="canonical" href="https://example.invalid/"></head>'))).toEqual([]);
  });

  it('findDataUrls counts data: URLs by MIME type', () => {
    const css = '.a{background:url("data:image/svg+xml;utf8,<svg/>")}.b{background:url(data:image/svg+xml;base64,AAA=)}@font-face{src:url(data:font/woff2;base64,AAAA) format("woff2")}';
    const found = findDataUrls(css).sort((a, b) => a.mime.localeCompare(b.mime));
    expect(found).toEqual([
      { mime: 'font/woff2', count: 1 },
      { mime: 'image/svg+xml', count: 2 },
    ]);
    expect(findDataUrls('h1{color:red}')).toEqual([]);
  });

  it('cspAllows resolves a directive with default-src fallback', () => {
    expect(cspAllows(csp, 'img-src', 'data:')).toBe(true);
    expect(cspAllows(csp, 'font-src', 'data:')).toBe(false);
    expect(cspAllows("default-src 'none'; img-src 'self'", 'font-src', 'data:')).toBe(false);
    expect(cspAllows("default-src 'self' data:", 'font-src', 'data:')).toBe(true);
    expect(cspAllows("default-src 'none'; font-src 'self' data:", 'font-src', 'data:')).toBe(true);
    // '*' matches network schemes only — never data: or blob: (CSP Level 3 source matching).
    expect(cspAllows("default-src 'none'; font-src *", 'font-src', 'data:')).toBe(false);
    expect(cspAllows("default-src 'none'; font-src *", 'font-src', 'https://fonts.example')).toBe(true);
  });

  it('runChecks passes a clean dist and reports (not fails) data: image URLs', () => {
    const dir = makeDist({ css: '.a{background:url(data:image/svg+xml;base64,AAA=)}\n' });
    const result = runChecks({ distDir: dir, budgetKb: 120, csp });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    const names = result.rows.map((r) => r.check);
    expect(names).toEqual(expect.arrayContaining(['no inline <script>', 'no <style> element', 'no style= attribute', 'no inline event handlers', 'asset URLs relative', 'JS gzip budget', 'THIRD_PARTY_LICENSES.txt', 'schemas parse', 'data: URLs in CSS']));
    const dataRow = result.rows.find((r) => r.check === 'data: URLs in CSS');
    expect(dataRow?.status).toBe('INFO');
    expect(dataRow?.detail).toContain('image/svg+xml');
    expect(result.rows.find((r) => r.check === 'JS gzip budget')?.status).toBe('PASS');
  });

  it('runChecks fails on the budget, a missing licence file, a broken schema, an inline script and CSP-blocked data: fonts', () => {
    const overBudget = runChecks({ distDir: makeDist(), budgetKb: 0.001, csp });
    expect(overBudget.ok).toBe(false);
    expect(overBudget.failures.some((f) => f.startsWith('JS gzip budget'))).toBe(true);

    const noLicence = runChecks({ distDir: makeDist({ licence: false }), budgetKb: 120, csp });
    expect(noLicence.failures.some((f) => f.startsWith('THIRD_PARTY_LICENSES.txt'))).toBe(true);

    const badSchema = runChecks({ distDir: makeDist({ schema: '{"$id": ' }), budgetKb: 120, csp });
    expect(badSchema.failures.some((f) => f.startsWith('schemas parse'))).toBe(true);

    const inline = runChecks({ distDir: makeDist({ index: CLEAN_INDEX.replace('</body>', '<script>alert(1)</script></body>') }), budgetKb: 120, csp });
    expect(inline.failures.some((f) => f.startsWith('no inline <script>'))).toBe(true);

    const dataFont = runChecks({ distDir: makeDist({ css: '@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA) format("woff2")}\n' }), budgetKb: 120, csp });
    expect(dataFont.failures.some((f) => f.startsWith('data: URLs vs production CSP'))).toBe(true);
    expect(dataFont.rows.find((r) => r.check === 'data: URLs in CSS')?.detail).toContain('font/woff2');

    const noSchemas = runChecks({ distDir: makeDist({ schema: null }), budgetKb: 120, csp });
    expect(noSchemas.ok).toBe(true);
    expect(noSchemas.rows.find((r) => r.check === 'schemas parse')?.status).toBe('WARN');
  });
});

describe('.github/workflows/verify.yml', () => {
  const yml = readFileSync(resolve(root, '.github/workflows/verify.yml'), 'utf8');
  const uses = yml.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l)).map((l) => l.replace(/^\s*-?\s*uses:\s*/, '').trim());

  it('pins every action to a 40-hex commit SHA and keeps the existing SHAs', () => {
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(uses).toContain(`actions/checkout@${CHECKOUT_SHA}`);
    expect(uses).toContain(`actions/setup-node@${SETUP_NODE_SHA}`);
  });

  it('keeps read-only permissions, the timeout and adds cancel-in-progress concurrency', () => {
    expect(yml).toMatch(/^permissions:\n\s+contents: read/m);
    expect(yml).toMatch(/timeout-minutes: 12/);
    expect(yml).toMatch(/^concurrency:\n\s+group: verify-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: true/m);
    expect(yml).toContain('persist-credentials: false');
  });

  it('runs on a Node 20 and 22 matrix fed into setup-node with npm caching', () => {
    expect(yml).toMatch(/node:\s*\[\s*'20'\s*,\s*'22'\s*\]/);
    expect(yml).toContain('node-version: ${{ matrix.node }}');
    expect(yml).toMatch(/cache:\s*npm/);
  });

  it('runs install, typecheck, tests, build, check-dist and audit in that order', () => {
    const steps = ['npm ci --no-fund', 'npm run typecheck', 'npm test', 'npm run build', 'node qa/check-dist.mjs', 'npm audit --audit-level=high'];
    const positions = steps.map((s) => yml.indexOf(`- run: ${s}`));
    for (const [i, p] of positions.entries()) expect(p, steps[i]).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
  });
});

describe('qa scripts are portable and honest about CSP', () => {
  const scripts = ['serve-dist.mjs', 'check-dist.mjs', 'workflow.mjs', 'axe-audit.mjs'];
  const docs = ['qa/README.md', 'docs/qa.md'];
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

  it('all four scripts and both documents exist', () => {
    for (const s of scripts) expect(existsSync(resolve(root, 'qa', s)), s).toBe(true);
    for (const d of docs) expect(existsSync(resolve(root, d)), d).toBe(true);
  });

  it('contain no private paths or harness placeholders', () => {
    for (const f of [...scripts.map((s) => 'qa/' + s), ...docs]) {
      if (!existsSync(resolve(root, f))) continue;
      const text = read(f);
      expect(text, f).not.toContain(PRIVATE_HOME);
      expect(text, f).not.toContain(TOOLS_PLACEHOLDER);
      expect(text, f).not.toContain(CHROMIUM_ENV);
    }
  });

  it('only the axe audit bypasses CSP, and labels that context', () => {
    for (const s of ['serve-dist.mjs', 'check-dist.mjs', 'workflow.mjs']) {
      if (!existsSync(resolve(root, 'qa', s))) continue;
      expect(read('qa/' + s), s).not.toContain('bypassCSP: true');
    }
    const axe = existsSync(resolve(root, 'qa/axe-audit.mjs')) ? read('qa/axe-audit.mjs') : '';
    expect(axe).toContain('bypassCSP: true');
    expect(axe).toContain('axe-instrumentation (bypassCSP: true; application CSP unchanged on the server)');
    expect(axe).toContain("'wcag2a', 'wcag2aa', 'wcag21aa'");
    for (const w of ['1440', '768', '375']) expect(axe).toContain(w);
  });

  it('the axe audit offers the --axe-source fallback and records which engine path ran', () => {
    const axe = existsSync(resolve(root, 'qa/axe-audit.mjs')) ? read('qa/axe-audit.mjs') : '';
    expect(axe).toContain('--axe-source');
    expect(axe).toContain('addScriptTag');
    expect(axe).toContain('window.axe.run(document');
    expect(axe).toContain("'@axe-core/playwright'");
    expect(axe).toContain("'axe-source: '");
    expect(axe).toContain('window.axe.version');
    for (const d of docs) {
      const text = existsSync(resolve(root, d)) ? read(d) : '';
      expect(text, d).toContain('--axe-source');
    }
  });

  it('the workflow loads Playwright optionally, keeps the 16 baseline checks and adds the 0.2 checks', () => {
    const wf = existsSync(resolve(root, 'qa/workflow.mjs')) ? read('qa/workflow.mjs') : '';
    expect(wf).toContain("Install playwright (and @axe-core/playwright) in a scratch directory and point NODE_PATH at its node_modules; browsers come from Playwright's default cache or PLAYWRIGHT_BROWSERS_PATH");
    expect(wf).not.toMatch(/^import .* from 'playwright'/m);
    expect(wf).toContain('securitypolicyviolation');
    const baseline = ['drawer shows PR.DS-11', 'status contradicted', 'reviewer acceptance refused banner', 'hash deep link', 'stale remediation text', 'status recomputed after add', 'two types -> sufficient', 'short N/A refused', 'substantive N/A accepted', 'import rejected with details', 'csv has header + 25 rows', 'report schema', 'empty gap register has 25 gaps', 'keyboard selects tile', 'no page/console errors', 'mobile no horizontal overflow'];
    const added = ['edit evidence', 'remove confirm dialog recorded', 'undo restores evidence', 'horizon lists EV-003 at 90 days', 'compare self import → all unchanged', 'policy min rationale 10 → GV.PO-01 sufficient', 'custom policy badge shown', 'gap register filter by function', 'summary present', 'markdown export downloaded', 'gap register CSV rows = gaps+1', 'evidence inventory CSV has header', 'session checkbox present', 'dark scheme screenshot', 'print screenshot', 'no CSP violations', 'no foreign requests', 'index and asset headers'];
    for (const name of [...baseline, ...added]) expect(wf, name).toContain(`'${name}'`);
  });
});
