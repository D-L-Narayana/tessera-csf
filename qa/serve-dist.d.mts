// Type declarations for qa/serve-dist.mjs (a dependency-free static server that applies the vercel.json headers).
import type { Server } from 'node:http';

export interface VercelHeader {
  key: string;
  value: string;
}

export interface VercelHeaderRule {
  source: string;
  headers: VercelHeader[];
}

export interface VercelConfig {
  $schema?: string;
  cleanUrls?: boolean;
  headers?: VercelHeaderRule[];
}

export interface ResolvedRequest {
  status: 200 | 308 | 404;
  /** Absolute path of the file to serve (status 200). */
  filePath?: string;
  /** Redirect target (status 308). */
  location?: string;
}

/** The minimal subset of http.IncomingMessage the handler reads. */
export interface MinimalRequest {
  method?: string;
  url?: string;
}

/** The minimal subset of http.ServerResponse the handler writes. */
export interface MinimalResponse {
  statusCode: number;
  setHeader(name: string, value: string | number): void;
  end(chunk?: string | Uint8Array): void;
}

export interface ServeOptions {
  distDir: string;
  config: VercelConfig;
  cleanUrls?: boolean;
}

export function loadVercelConfig(configPath: string): VercelConfig;
export function sourceToRegExp(source: string): RegExp;
export function headersFor(pathname: string, config: VercelConfig): Record<string, string>;
export function contentTypeFor(pathname: string): string;
export function resolveRequest(rawUrl: string, distDir: string, options?: { cleanUrls?: boolean }): ResolvedRequest;
export function handleRequest(req: MinimalRequest, res: MinimalResponse, options: ServeOptions): Promise<void>;
export function createServer(options: ServeOptions): Server;
