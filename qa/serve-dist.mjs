#!/usr/bin/env node
// Static server for browser QA that applies the production response headers from vercel.json.
// Node built-ins only. Importable (loadVercelConfig, headersFor, contentTypeFor, …) and runnable:
//
//   node qa/serve-dist.mjs [--port 6120] [--host 127.0.0.1] [--dist dist] [--config vercel.json]
//
// Every response — documents, hashed assets, cleanUrls redirects, 404s — carries the headers Vercel sends for
// the deployed site (Content-Security-Policy, HSTS, nosniff, frame denial, caching …). There is no option to
// relax them: the point of this server is that qa/workflow.mjs measures the application under the real policy
// instead of a headerless preview.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const USAGE = `usage: node qa/serve-dist.mjs [--port 6120] [--host 127.0.0.1] [--dist dist] [--config vercel.json]
Serves a built dist/ directory with the response headers declared in vercel.json (never relaxed).`;

/** Read and lightly validate a vercel.json file. */
export function loadVercelConfig(configPath) {
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${configPath}: expected a JSON object`);
  for (const [i, rule] of (parsed.headers ?? []).entries()) {
    if (!rule || typeof rule.source !== 'string' || !Array.isArray(rule.headers)) throw new Error(`${configPath}: headers[${i}] needs a "source" string and a "headers" array`);
    for (const [j, h] of rule.headers.entries()) {
      if (!h || typeof h.key !== 'string' || typeof h.value !== 'string') throw new Error(`${configPath}: headers[${i}].headers[${j}] needs "key" and "value" strings`);
    }
  }
  return parsed;
}

const regexCache = new Map();

/**
 * Convert a Vercel "source" (path-to-regexp syntax) into an anchored RegExp.
 * Supported: literal segments, "(regex)" groups such as "/(.*)" and "/assets/(.*)", ":name" and ":name(regex)"
 * parameters, "*" and the "?" optional modifier. A trailing slash is tolerated, as path-to-regexp does by default.
 */
export function sourceToRegExp(source) {
  const cached = regexCache.get(source);
  if (cached) return cached;
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(') {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === '\\') {
          j++;
          continue;
        }
        if (source[j] === '(') depth++;
        else if (source[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) throw new Error(`unbalanced parentheses in source "${source}"`);
      out += '(?:' + source.slice(i + 1, j) + ')';
      i = j + 1;
    } else if (ch === ':') {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      if (source[j] === '(') {
        let depth = 0;
        let k = j;
        for (; k < source.length; k++) {
          if (source[k] === '\\') {
            k++;
            continue;
          }
          if (source[k] === '(') depth++;
          else if (source[k] === ')') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (depth !== 0) throw new Error(`unbalanced parentheses in source "${source}"`);
        out += '(?:' + source.slice(j + 1, k) + ')';
        i = k + 1;
      } else {
        out += '(?:[^/]+)';
        i = j;
      }
    } else if (ch === '*') {
      out += '.*';
      i++;
    } else if (ch === '?') {
      out += '?';
      i++;
    } else {
      out += ch.replace(/[.+^${}|[\]\\]/g, '\\$&');
      i++;
    }
  }
  const re = new RegExp('^' + out + '/?$');
  regexCache.set(source, re);
  return re;
}

/** Headers that apply to a request path: every matching rule in order, later rules overriding earlier ones per key. */
export function headersFor(pathname, config) {
  const result = {};
  for (const rule of config?.headers ?? []) {
    if (!sourceToRegExp(rule.source).test(pathname)) continue;
    for (const { key, value } of rule.headers) {
      for (const existing of Object.keys(result)) if (existing.toLowerCase() === key.toLowerCase()) delete result[existing];
      result[key] = value;
    }
  }
  return result;
}

export function contentTypeFor(pathname) {
  const ext = path.posix.extname(String(pathname).split(/[?#]/)[0]).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function isFile(p) {
  return statSafe(p)?.isFile() ?? false;
}

function insideRoot(filePath, root) {
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(filePath);
    return real === realRoot || real.startsWith(realRoot + path.sep);
  } catch {
    return false;
  }
}

/** Decoded request pathname (no query/fragment) used for header matching; never throws. */
function requestPathname(rawUrl) {
  let p = String(rawUrl || '/');
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      p = '/';
    }
  }
  p = p.split(/[?#]/)[0] || '/';
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep the raw path; resolveRequest answers 404 for it */
  }
  return p.startsWith('/') ? p : '/' + p;
}

/**
 * Map a request URL to a file inside distDir with cleanUrls semantics:
 *   "/" → index.html; "/name" → name.html when it exists; "/name.html" → 308 to "/name" (and "/index.html" → "/").
 * Anything that would resolve outside distDir (dot segments, encoded traversal, symlinks) is a 404.
 */
export function resolveRequest(rawUrl, distDir, { cleanUrls = true } = {}) {
  const root = path.resolve(distDir);
  let target = String(rawUrl || '/');
  if (/^https?:\/\//i.test(target)) {
    try {
      const u = new URL(target);
      target = u.pathname + u.search;
    } catch {
      return { status: 404 };
    }
  }
  const qIndex = target.search(/[?#]/);
  const query = qIndex === -1 ? '' : target.slice(qIndex).split('#')[0];
  let pathname = qIndex === -1 ? target : target.slice(0, qIndex);
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return { status: 404 };
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return { status: 404 };
  if (!pathname.startsWith('/')) pathname = '/' + pathname;
  if (pathname.split('/').some((segment) => segment === '..')) return { status: 404 };
  const normalized = path.posix.normalize(pathname);
  const filePath = path.resolve(root, '.' + normalized);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return { status: 404 };

  if (cleanUrls && /\.html$/i.test(normalized)) {
    let location = normalized.replace(/\.html$/i, '');
    if (/(^|\/)index$/.test(location)) location = location.slice(0, -'index'.length);
    if (location.length > 1 && location.endsWith('/')) location = location.slice(0, -1);
    if (location === '') location = '/';
    return { status: 308, location: location + query };
  }

  const st = statSafe(filePath);
  if (st?.isDirectory()) {
    const index = path.join(filePath, 'index.html');
    return isFile(index) && insideRoot(index, root) ? { status: 200, filePath: index } : { status: 404 };
  }
  if (st?.isFile()) return insideRoot(filePath, root) ? { status: 200, filePath } : { status: 404 };
  if (cleanUrls && !path.posix.extname(normalized)) {
    const html = filePath + '.html';
    if (isFile(html) && insideRoot(html, root)) return { status: 200, filePath: html };
  }
  return { status: 404 };
}

function sendText(res, status, text, headOnly, extraHeaders = {}) {
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  const body = Buffer.from(text, 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.end(headOnly ? undefined : body);
}

/** Handle one request. Works with node:http objects and with minimal fakes ({ method, url } / { statusCode, setHeader, end }). */
export async function handleRequest(req, res, { distDir, config, cleanUrls } = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const rawUrl = req.url || '/';
  for (const [k, v] of Object.entries(headersFor(requestPathname(rawUrl), config))) res.setHeader(k, v);
  const headOnly = method === 'HEAD';
  if (method !== 'GET' && !headOnly) return sendText(res, 405, 'Method not allowed', false, { Allow: 'GET, HEAD' });
  const resolved = resolveRequest(rawUrl, distDir, { cleanUrls: cleanUrls ?? config?.cleanUrls ?? true });
  if (resolved.status === 308) return sendText(res, 308, '', headOnly, { Location: resolved.location });
  if (resolved.status !== 200) return sendText(res, 404, 'Not found', headOnly);
  const body = await fs.promises.readFile(resolved.filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(resolved.filePath));
  res.setHeader('Content-Length', body.length);
  res.end(headOnly ? undefined : body);
}

/** Create (but do not start) an http.Server serving distDir with the vercel.json headers. */
export function createServer(options) {
  const config = options.config ?? loadVercelConfig(options.configPath ?? 'vercel.json');
  const opts = { ...options, config };
  return http.createServer((req, res) => {
    handleRequest(req, res, opts).catch((err) => {
      console.error(`[serve-dist] ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      res.end('Internal error');
    });
  });
}

function parseArgs(argv) {
  const opts = { port: 6120, host: '127.0.0.1', dist: 'dist', config: 'vercel.json', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === '--port') opts.port = Number(next());
    else if (arg === '--host') opts.host = next();
    else if (arg === '--dist') opts.dist = next();
    else if (arg === '--config') opts.config = next();
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error('--port must be an integer between 0 and 65535');
  return opts;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`serve-dist: ${err.message}\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const distDir = path.resolve(opts.dist);
  const shownDist = path.relative(process.cwd(), distDir) || '.';
  if (!isFile(path.join(distDir, 'index.html'))) {
    console.error(`serve-dist: ${shownDist}/index.html not found — run "npm run build" first`);
    process.exit(1);
  }
  let config;
  try {
    config = loadVercelConfig(path.resolve(opts.config));
  } catch (err) {
    console.error(`serve-dist: cannot read ${opts.config}: ${err.message}`);
    process.exit(1);
  }
  const server = createServer({ distDir, config });
  server.on('request', (req, res) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) console.error(`[serve-dist] ${res.statusCode} ${req.method} ${req.url}`);
    });
  });
  server.listen(opts.port, opts.host, () => {
    console.log(`serving ${shownDist} on http://${opts.host}:${opts.port}`);
  });
  const stop = () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
