// Seeded fuzzing helpers for the validator and the engine invariants. Everything here is deterministic:
// the same seed always yields the same pack or the same mutation, so a failing case is reproducible from
// its seed alone. Nothing depends on wall-clock time or Math.random.
import { CATALOG } from '../../src/engine/catalog';
import { POLICY_BOUNDS, type RulePolicy } from '../../src/engine/policy';
import {
  EVIDENCE_TYPES,
  type Decision,
  type Evidence,
  type EvidencePack,
  type Priority,
  type Status,
  type Verdict,
} from '../../src/engine/types';

export type Rng = () => number;

/** mulberry32: a small 32-bit generator; returns floats in [0, 1). The state wraps at 2^32 on purpose. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [min, max] (both inclusive). */
export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[int(rng, 0, items.length - 1)];
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Printable text without control characters; spaces are over-represented so words appear.
const TEXT = LETTERS + '0123456789      .,;:-()/éü–';

function chars(rng: Rng, count: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < count; i++) out += alphabet[int(rng, 0, alphabet.length - 1)];
  return out;
}

/** Non-blank short string of 1..max characters that starts with a letter (may end with a space). */
function shortText(rng: Rng, max: number): string {
  const length = int(rng, 1, max);
  return chars(rng, 1, LETTERS) + chars(rng, length - 1, TEXT);
}

/** Long text of 0..max characters; may contain line feeds and tabs, which notes and rationales allow. */
function longText(rng: Rng, max: number): string {
  return chars(rng, int(rng, 0, max), TEXT + '\n\t');
}

/** A real calendar date between fromYear and toYear (days 1..28 so every month is valid). */
export function isoDate(rng: Rng, fromYear = 2020, toYear = 2027): string {
  const y = int(rng, fromYear, toYear);
  const m = int(rng, 1, 12);
  const d = int(rng, 1, 28);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const SUBCATEGORY_IDS: readonly string[] = CATALOG.map((s) => s.id);
const VERDICTS: readonly Verdict[] = ['accepted', 'gap', 'needs-more', 'not-applicable'];
/** Canonical exposure key order (the order of DEFAULT_POLICY.exposure). */
const STATUSES: readonly Status[] = ['none', 'refuted', 'contradicted', 'weak', 'partial', 'sufficient', 'accepted-risk', 'not-applicable'];

function distinctIds(rng: Rng, count: number): string[] {
  return shuffle(rng, [...SUBCATEGORY_IDS]).slice(0, count);
}

const pct = (x: number): number => Math.round(x * 100);
const hundredths = (n: number): number => n / 100;

/** A random policy that satisfies every bound and ordering rule in POLICY_BOUNDS, in canonical key order. */
export function randomPolicy(rng: Rng): RulePolicy {
  const B = POLICY_BOUNDS;
  const fresh = int(rng, pct(B.weight.min), pct(B.weight.max));
  const aging = int(rng, pct(B.weight.min), fresh);
  const stale = int(rng, pct(B.weight.min), aging);
  const full = int(rng, pct(B.weight.min), pct(B.weight.max));
  const partial = int(rng, pct(B.weight.min), full);
  const moderate = int(rng, pct(B.band.min), pct(B.band.max) - 1);
  const high = int(rng, moderate + 1, pct(B.band.max));
  const exposure = {} as Record<Status, number>;
  for (const s of STATUSES) {
    exposure[s] = s === 'not-applicable' ? 0 : hundredths(int(rng, pct(B.exposure.min), pct(B.exposure.max)));
  }
  return {
    schema: 'tessera.policy/1',
    agingMultiplier: hundredths(int(rng, pct(B.agingMultiplier.min), pct(B.agingMultiplier.max))),
    freshnessWeights: { fresh: hundredths(fresh), aging: hundredths(aging), stale: hundredths(stale) },
    scopeWeights: { full: hundredths(full), partial: hundredths(partial) },
    sufficientCoverage: hundredths(int(rng, pct(B.sufficientCoverage.min), pct(B.sufficientCoverage.max))),
    minDistinctTypes: int(rng, B.minDistinctTypes.min, B.minDistinctTypes.max),
    exposure,
    bands: { moderate: hundredths(moderate), high: hundredths(high) },
    minOverrideRationale: int(rng, B.minOverrideRationale.min, B.minOverrideRationale.max),
    decisionValidDays: int(rng, B.decisionValidDays.min, B.decisionValidDays.max),
    separationOfDuties: chance(rng, 0.5),
  };
}

export interface RandomPackOptions {
  maxEvidence?: number;
  maxDecisions?: number;
  withPolicy?: boolean;
}

/**
 * A valid, bounded pack: catalog ids only, real dates from 2020 to 2027 (so some artifacts and decisions are
 * dated after asOf), validDays 1..3650, random scopes/assertions/types, optional note and collectedBy,
 * decisions on distinct subcategories with 0..120-character rationales, random priorities and, on request,
 * a random in-bounds policy. Objects are built in the validator's key order so a round trip is byte-identical.
 */
export function randomPack(rng: Rng, opts: RandomPackOptions = {}): EvidencePack {
  const maxEvidence = Math.min(opts.maxEvidence ?? 40, 500);
  const maxDecisions = Math.min(opts.maxDecisions ?? 20, SUBCATEGORY_IDS.length);
  const asOf = isoDate(rng);
  const priorities: Record<string, Priority> = {};
  for (const id of distinctIds(rng, int(rng, 0, SUBCATEGORY_IDS.length))) priorities[id] = pick(rng, [1, 2, 3] as const);

  const collectors: string[] = [];
  const evidence: Evidence[] = [];
  const evidenceCount = int(rng, 0, maxEvidence);
  for (let i = 0; i < evidenceCount; i++) {
    const e: Evidence = {
      id: `${pick(rng, ['EV', 'ART', 'doc'])}-${i + 1}`,
      title: shortText(rng, 60),
      type: pick(rng, EVIDENCE_TYPES),
      subcategoryIds: distinctIds(rng, int(rng, 1, 4)),
      collectedOn: isoDate(rng),
      validDays: int(rng, 1, 3650),
      scope: chance(rng, 0.6) ? 'full' : 'partial',
      assertion: chance(rng, 0.8) ? 'supports' : 'refutes',
      source: `${chars(rng, int(rng, 3, 10), LETTERS).toLowerCase()}.example`,
    };
    if (chance(rng, 0.4)) e.note = longText(rng, 200);
    if (chance(rng, 0.5)) {
      e.collectedBy = collectors.length > 0 && chance(rng, 0.5) ? pick(rng, collectors) : shortText(rng, 30);
      collectors.push(e.collectedBy);
    }
    evidence.push(e);
  }

  const decisions: Decision[] = distinctIds(rng, int(rng, 0, maxDecisions)).map((subcategoryId) => ({
    subcategoryId,
    // Sometimes the reviewer is also a collector, which exercises the separation-of-duties guardrail.
    reviewer: collectors.length > 0 && chance(rng, 0.3) ? pick(rng, collectors) : shortText(rng, 20),
    verdict: pick(rng, VERDICTS),
    rationale: longText(rng, 120),
    decidedOn: isoDate(rng),
  }));

  const pack: EvidencePack = {
    schema: 'tessera.pack/1',
    profile: { name: `Fuzz profile ${shortText(rng, 20)}`, asOf, priorities },
    evidence,
    decisions,
  };
  if (opts.withPolicy) pack.policy = randomPolicy(rng);
  return pack;
}

// ---------------------------------------------------------------------------------------------------------
// JSON mutation

type Key = string | number;
type Path = Key[];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Every node path in the tree (root included), bounded in count and depth so mutated trees stay cheap. */
function collectPaths(root: unknown, limit = 4000, maxDepth = 48): Path[] {
  const out: Path[] = [[]];
  const stack: { node: unknown; path: Path }[] = [{ node: root, path: [] }];
  while (stack.length > 0 && out.length < limit) {
    const { node, path } = stack.pop()!;
    if (path.length >= maxDepth || node === null || typeof node !== 'object') continue;
    const entries: [Key, unknown][] = Array.isArray(node)
      ? node.map((child, i): [Key, unknown] => [i, child])
      : Object.entries(node as Record<string, unknown>);
    for (const [key, child] of entries) {
      const next = [...path, key];
      out.push(next);
      stack.push({ node: child, path: next });
    }
  }
  return out;
}

function getAt(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[String(key)];
  }
  return cur;
}

function setAt(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const parent = getAt(root, path.slice(0, -1));
  if (parent !== null && typeof parent === 'object') {
    (parent as Record<string, unknown>)[String(path[path.length - 1])] = value;
  }
  return root;
}

function deleteAt(root: unknown, path: Path): unknown {
  if (path.length === 0) return null;
  const parent = getAt(root, path.slice(0, -1));
  const key = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else if (isRecord(parent)) delete parent[String(key)];
  return root;
}

const SWAPS: readonly unknown[] = [null, true, false, 0, -1, 2.5, '', 'text', [], {}, [1, 2], { nested: { deeper: true } }];
const ODD_NUMBERS: readonly unknown[] = [
  'NaN', 'Infinity', '-Infinity', 1e308, -1e308, 9007199254740993, 5e-324, 1e21, 0, -0, 0.1 + 0.2,
  3651, 2001, 501, 26, 4, 0.5, 1.5,
];
const BAD_DATES: readonly string[] = [
  '2026-02-30', '2026-13-01', '31/12/2026', '2026-1-1', '20260101', '0000-00-00', '2026-10-01T00:00:00Z',
  '2026-02-29', '9999-12-31', '',
];

/** Hostile variants of a string: blanks, outer whitespace, control characters, a zero-width space, a lone surrogate, unknown ids. */
function perturbString(rng: Rng, s: string): string {
  return pick(rng, [
    '', ' ', '   ', ` ${s}`, `${s} `, `${s}\n`, `\u0000${s}`, `${s}\u007f`, `${s.slice(0, 1)}\u001f${s.slice(1)}`,
    '\t', s.toUpperCase(), 'PR.ZZ-99', 'tessera.pack/2', s.repeat(3), `${s}​`, `\ud800${s}`, ' ',
  ]);
}

function duplicateEntry(rng: Rng, root: unknown): boolean {
  if (!isRecord(root)) return false;
  for (const key of shuffle(rng, ['evidence', 'decisions'])) {
    const list = root[key];
    if (Array.isArray(list) && list.length > 0) {
      const items = list as unknown[];
      items.push(structuredClone(pick(rng, items)));
      return true;
    }
  }
  return false;
}

const KINDS = ['swap', 'delete', 'giant', 'odd-number', 'deep', 'duplicate', 'unknown-key', 'string', 'number', 'date'] as const;

function mutateOnce(rng: Rng, root: unknown): unknown {
  const path = pick(rng, collectPaths(root));
  const node = getAt(root, path);
  const swap = (): unknown => setAt(root, path, structuredClone(pick(rng, SWAPS)));
  switch (pick(rng, KINDS)) {
    case 'swap':
      return swap();
    case 'delete':
      return deleteAt(root, path);
    case 'giant':
      return setAt(root, path, pick(rng, ['x', '€', ' ', 'A']).repeat(10_000));
    case 'odd-number':
      return setAt(root, path, pick(rng, ODD_NUMBERS));
    case 'deep': {
      let nested: unknown = [];
      const depth = int(rng, 50, 300);
      for (let i = 0; i < depth; i++) nested = [nested];
      return setAt(root, path, nested);
    }
    case 'duplicate':
      return duplicateEntry(rng, root) ? root : swap();
    case 'unknown-key': {
      if (Array.isArray(node)) {
        (node as unknown[]).push(structuredClone(pick(rng, SWAPS)));
        return root;
      }
      const target = isRecord(node) ? node : isRecord(root) ? root : null;
      if (target) {
        target[`x_${chars(rng, 6, LETTERS)}`] = structuredClone(pick(rng, SWAPS));
        return root;
      }
      return swap();
    }
    case 'string':
      return typeof node === 'string' ? setAt(root, path, perturbString(rng, node)) : swap();
    case 'number':
      return typeof node === 'number'
        ? setAt(root, path, pick(rng, [-node, node + 0.5, node * 1e6, 0, node + 1, -1, node / 3]))
        : swap();
    case 'date':
      return typeof node === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(node) ? setAt(root, path, pick(rng, BAD_DATES)) : swap();
    default:
      return swap();
  }
}

/**
 * A deep copy of `value` with 1..5 random mutations applied: type swaps, key/element deletion, 10 000-character
 * strings, NaN/Infinity-like tokens (as strings) and extreme numbers, deeply nested arrays, duplicated evidence
 * or decision entries, unknown keys, hostile strings (control characters, surrounding whitespace, lone
 * surrogates, unknown ids) and malformed dates. Never throws; the result may or may not still be a valid pack.
 */
export function mutateJson(rng: Rng, value: unknown): unknown {
  let root: unknown = structuredClone(value);
  const rounds = int(rng, 1, 5);
  for (let i = 0; i < rounds; i++) root = mutateOnce(rng, root);
  return root;
}
