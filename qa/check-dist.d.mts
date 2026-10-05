// Type declarations for qa/check-dist.mjs (dependency-free build-output checks).

export interface IndexFinding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface DataUrlCount {
  mime: string;
  count: number;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'INFO' | 'WARN';

export interface CheckRow {
  check: string;
  status: CheckStatus;
  detail: string;
}

export interface CheckResult {
  ok: boolean;
  failures: string[];
  rows: CheckRow[];
}

export interface RunOptions {
  distDir: string;
  budgetKb: number;
  /** Production Content-Security-Policy; when given, data: URLs found in CSS are checked against it. */
  csp?: string;
}

export function checkIndexHtml(html: string): IndexFinding[];
export function findDataUrls(css: string): DataUrlCount[];
export function cspAllows(csp: string, directive: string, sourceToken: string): boolean;
export function runChecks(options: RunOptions): CheckResult;
