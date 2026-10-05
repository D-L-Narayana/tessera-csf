// Drift guards for the published JSON Schemas (public/schemas). A compact draft-2020-12 subset walker checks
// that the fixture pack and the report built from it conform, that every object key is declared, that every
// `required` key is present, and that enums and bounds equal the engine's own constants.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/engine/catalog';
import { buildReport } from '../src/engine/evaluate';
import { DEFAULT_POLICY, POLICY_BOUNDS } from '../src/engine/policy';
import { EVIDENCE_TYPES, type EvidencePack, type Status, type Verdict } from '../src/engine/types';
import { MAX_DECISIONS, MAX_EVIDENCE, MAX_SHORT, MAX_SUBCATEGORY_REFS, MAX_TEXT, validatePack } from '../src/engine/validate';
import demo from '../src/fixtures/harbourline-pack.json';
import { AS_OF, ev, pack } from './helpers/pack';

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function load(name: string): Dict {
  const file = fileURLToPath(new URL(`../public/schemas/${name}`, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return isDict(parsed) ? parsed : {};
}

function get(node: unknown, path: string): unknown {
  let cur: unknown = node;
  for (const seg of path.split('.')) {
    if (!isDict(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Follow local `$ref`s (`#/...`) inside the same document. */
function resolve(root: Dict, node: unknown): Dict {
  let cur: unknown = node;
  for (let hops = 0; isDict(cur) && typeof cur.$ref === 'string'; hops++) {
    if (hops > 20) throw new Error('circular $ref');
    const ref = cur.$ref;
    if (!ref.startsWith('#/')) throw new Error(`external $ref not supported: ${ref}`);
    let target: unknown = root;
    for (const seg of ref.slice(2).split('/')) {
      if (!isDict(target)) throw new Error(`unresolved $ref ${ref}`);
      target = target[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    if (target === undefined) throw new Error(`unresolved $ref ${ref}`);
    cur = target;
  }
  return isDict(cur) ? cur : {};
}

function jsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function check(root: Dict, schema: unknown, value: unknown, path: string, issues: string[]): void {
  const node = resolve(root, schema);
  const at = path || '(root)';
  if (node.type !== undefined) {
    const allowed = (Array.isArray(node.type) ? node.type : [node.type]) as string[];
    const t = jsonType(value);
    if (!allowed.includes(t) && !(t === 'integer' && allowed.includes('number'))) issues.push(`${at}: type ${t} is not ${allowed.join('|')}`);
  }
  if ('const' in node && JSON.stringify(node.const) !== JSON.stringify(value)) issues.push(`${at}: expected const ${JSON.stringify(node.const)}`);
  if (Array.isArray(node.enum) && !node.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) issues.push(`${at}: ${JSON.stringify(value)} is not in enum`);
  if (typeof value === 'string') {
    if (typeof node.minLength === 'number' && value.length < node.minLength) issues.push(`${at}: shorter than ${node.minLength}`);
    if (typeof node.maxLength === 'number' && value.length > node.maxLength) issues.push(`${at}: longer than ${node.maxLength}`);
    if (typeof node.pattern === 'string' && !new RegExp(node.pattern).test(value)) issues.push(`${at}: does not match ${node.pattern}`);
  }
  if (typeof value === 'number') {
    if (typeof node.minimum === 'number' && value < node.minimum) issues.push(`${at}: below minimum ${node.minimum}`);
    if (typeof node.maximum === 'number' && value > node.maximum) issues.push(`${at}: above maximum ${node.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof node.minItems === 'number' && value.length < node.minItems) issues.push(`${at}: fewer than ${node.minItems} items`);
    if (typeof node.maxItems === 'number' && value.length > node.maxItems) issues.push(`${at}: more than ${node.maxItems} items`);
    if (isDict(node.items)) value.forEach((v, i) => check(root, node.items, v, `${path}[${i}]`, issues));
    else issues.push(`${at}: array has no items schema`);
  } else if (isDict(value)) {
    const props = isDict(node.properties) ? node.properties : {};
    const required = Array.isArray(node.required) ? (node.required as string[]) : [];
    for (const r of required) if (!(r in value)) issues.push(`${at}: missing required property ${r}`);
    const keys = Object.keys(value);
    if (typeof node.maxProperties === 'number' && keys.length > node.maxProperties) issues.push(`${at}: more than ${node.maxProperties} properties`);
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      if (isDict(node.propertyNames)) check(root, node.propertyNames, k, `${p} (property name)`, issues);
      if (k in props) check(root, props[k], value[k], p, issues);
      else if (isDict(node.additionalProperties)) check(root, node.additionalProperties, value[k], p, issues);
      else issues.push(`${p}: not declared in schema properties`);
    }
  }
}

function conforms(root: Dict, value: unknown): string[] {
  const issues: string[] = [];
  check(root, root, value, '', issues);
  return issues;
}

function collectRefs(node: unknown, out: string[]): void {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (isDict(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
}

function objectSchemas(node: unknown, path: string, out: { path: string; node: Dict }[]): void {
  if (Array.isArray(node)) node.forEach((n, i) => objectSchemas(n, `${path}[${i}]`, out));
  else if (isDict(node)) {
    if (node.type === 'object') out.push({ path, node });
    for (const [k, v] of Object.entries(node)) if (k !== 'enum' && k !== 'const' && k !== 'required') objectSchemas(v, `${path}/${k}`, out);
  }
}

/** Exported JSON is what the schema describes, so instances are round-tripped through JSON first. */
function json(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

const packSchema = load('tessera.pack.v1.schema.json');
const reportSchema = load('tessera.report.v1.schema.json');

const STATUSES: Status[] = ['sufficient', 'partial', 'weak', 'none', 'contradicted', 'refuted', 'accepted-risk', 'not-applicable'];
const VERDICTS: Verdict[] = ['accepted', 'gap', 'needs-more', 'not-applicable'];
const CATALOG_ID_LIST = CATALOG.map((s) => s.id);
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

function demoPack(): EvidencePack {
  const r = validatePack(JSON.stringify(demo));
  if (!r.ok) throw new Error('bundled fixture failed validation');
  return r.pack;
}
const fixture = demoPack();

function customPack(): EvidencePack {
  const base = pack(
    [ev({ id: 'E1', collectedBy: 'a.lee', note: 'Collected during the walkthrough.' }), ev({ id: 'E2', type: 'configuration', subcategoryIds: ['PR.AA-05', 'PR.AA-01'] })],
    [{ subcategoryId: 'PR.AA-05', reviewer: 'r.kaur', verdict: 'accepted', rationale: 'Compensating manual review observed during the walkthrough on 2026-09-20.', decidedOn: AS_OF }],
    { priorities: { 'PR.AA-05': 3, 'GV.PO-01': 1 } },
  );
  return { ...base, policy: { ...DEFAULT_POLICY, decisionValidDays: 180, minOverrideRationale: 10, separationOfDuties: false } };
}

describe('schema files', () => {
  it('both schemas are draft 2020-12 documents published under the deployment origin', () => {
    expect(packSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(reportSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(packSchema.$id).toBe('https://dln-tessera.vercel.app/schemas/tessera.pack.v1.schema.json');
    expect(reportSchema.$id).toBe('https://dln-tessera.vercel.app/schemas/tessera.report.v1.schema.json');
    expect(packSchema.type).toBe('object');
    expect(reportSchema.type).toBe('object');
  });

  it('pin the schema tags as constants', () => {
    expect(get(packSchema, 'properties.schema.const')).toBe('tessera.pack/1');
    expect(get(reportSchema, 'properties.schema.const')).toBe('tessera.report/1');
    expect(get(resolve(packSchema, get(packSchema, 'properties.policy')), 'properties.schema.const')).toBe('tessera.policy/1');
    expect(get(resolve(reportSchema, get(reportSchema, 'properties.policy')), 'properties.schema.const')).toBe('tessera.policy/1');
  });

  it('every local $ref resolves inside its own document', () => {
    for (const root of [packSchema, reportSchema]) {
      const refs: string[] = [];
      collectRefs(root, refs);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(() => resolve(root, { $ref: ref })).not.toThrow();
    }
  });

  it('every object schema forbids undeclared properties (bounded maps carry a value schema instead)', () => {
    for (const root of [packSchema, reportSchema]) {
      const found: { path: string; node: Dict }[] = [];
      objectSchemas(root, '#', found);
      expect(found.length).toBeGreaterThan(5);
      for (const { path, node } of found) {
        if (isDict(node.properties)) expect([path, node.additionalProperties]).toEqual([path, false]);
        else {
          expect([path, isDict(node.additionalProperties)]).toEqual([path, true]);
          expect([path, typeof node.maxProperties]).toEqual([path, 'number']);
        }
      }
    }
  });

  it('the pack and report schemas share identical decision and policy definitions', () => {
    for (const name of ['decision', 'policy', 'isoDate', 'subcategoryId', 'longText', 'person', 'weight', 'exposureFactor', 'bandThreshold']) {
      expect(get(packSchema, `$defs.${name}`)).toBeDefined();
      expect(get(reportSchema, `$defs.${name}`)).toEqual(get(packSchema, `$defs.${name}`));
    }
  });
});

describe('pack schema (tessera.pack/1)', () => {
  it('accepts the bundled fixture pack, with and without the default policy attached', () => {
    expect(conforms(packSchema, json(fixture))).toEqual([]);
    expect(conforms(packSchema, json({ ...fixture, policy: DEFAULT_POLICY }))).toEqual([]);
  });

  it('accepts a pack with a custom policy, collectedBy, notes, decisions and priorities', () => {
    expect(conforms(packSchema, json(customPack()))).toEqual([]);
  });

  it('flags undeclared keys, missing required keys and out-of-enum values (the walker is not vacuous)', () => {
    const extra = conforms(packSchema, json({ ...fixture, extra: 1 }));
    expect(extra.some((i) => i.startsWith('extra:'))).toBe(true);
    const noProfile = json(fixture) as Dict;
    delete noProfile.profile;
    expect(conforms(packSchema, noProfile).some((i) => /missing required property profile/.test(i))).toBe(true);
    const badType = json(pack([ev({ id: 'E1' })])) as { evidence: { type: string }[] };
    badType.evidence[0].type = 'screenshot';
    expect(conforms(packSchema, badType).some((i) => /evidence\[0\]\.type: .*not in enum/.test(i))).toBe(true);
    const tooMany = json(pack(Array.from({ length: MAX_EVIDENCE + 1 }, (_, i) => ev({ id: 'E' + i }))));
    expect(conforms(packSchema, tooMany).some((i) => /^evidence: more than 500 items/.test(i))).toBe(true);
  });

  it('enumerates evidence types, verdicts, scopes, assertions and priorities exactly as the engine does', () => {
    const evidence = resolve(packSchema, get(packSchema, 'properties.evidence.items'));
    expect(resolve(packSchema, get(evidence, 'properties.type')).enum).toEqual([...EVIDENCE_TYPES]);
    expect(resolve(packSchema, get(evidence, 'properties.scope')).enum).toEqual(['full', 'partial']);
    expect(resolve(packSchema, get(evidence, 'properties.assertion')).enum).toEqual(['supports', 'refutes']);
    const decision = resolve(packSchema, get(packSchema, 'properties.decisions.items'));
    expect(resolve(packSchema, get(decision, 'properties.verdict')).enum).toEqual(VERDICTS);
    const priorities = resolve(packSchema, get(resolve(packSchema, get(packSchema, 'properties.profile')), 'properties.priorities'));
    expect(resolve(packSchema, priorities.additionalProperties).enum).toEqual([1, 2, 3]);
  });

  it('restricts subcategory identifiers to the 25 catalog ids in evidence references, decisions and priorities', () => {
    const evidence = resolve(packSchema, get(packSchema, 'properties.evidence.items'));
    const refs = resolve(packSchema, get(evidence, 'properties.subcategoryIds'));
    expect(resolve(packSchema, refs.items).enum).toEqual(CATALOG_ID_LIST);
    const decision = resolve(packSchema, get(packSchema, 'properties.decisions.items'));
    expect(resolve(packSchema, get(decision, 'properties.subcategoryId')).enum).toEqual(CATALOG_ID_LIST);
    expect(resolve(packSchema, get(decision, 'properties.subcategoryId')).maxLength).toBe(16);
    const priorities = resolve(packSchema, get(resolve(packSchema, get(packSchema, 'properties.profile')), 'properties.priorities'));
    expect(resolve(packSchema, priorities.propertyNames).enum).toEqual(CATALOG_ID_LIST);
  });

  it('mirrors the validator bounds: string lengths, counts and ranges', () => {
    const profile = resolve(packSchema, get(packSchema, 'properties.profile'));
    expect(resolve(packSchema, get(profile, 'properties.name')).maxLength).toBe(MAX_SHORT);
    expect(resolve(packSchema, get(profile, 'properties.name')).minLength).toBe(1);
    const priorities = resolve(packSchema, get(profile, 'properties.priorities'));
    expect(priorities.maxProperties).toBe(MAX_SUBCATEGORY_REFS);
    expect(get(packSchema, 'properties.evidence.maxItems')).toBe(MAX_EVIDENCE);
    expect(get(packSchema, 'properties.decisions.maxItems')).toBe(MAX_DECISIONS);
    const evidence = resolve(packSchema, get(packSchema, 'properties.evidence.items'));
    expect(resolve(packSchema, get(evidence, 'properties.id')).maxLength).toBe(64);
    expect(resolve(packSchema, get(evidence, 'properties.title')).maxLength).toBe(MAX_SHORT);
    expect(resolve(packSchema, get(evidence, 'properties.source')).maxLength).toBe(MAX_SHORT);
    expect(resolve(packSchema, get(evidence, 'properties.collectedBy')).maxLength).toBe(80);
    expect(resolve(packSchema, get(evidence, 'properties.note')).maxLength).toBe(MAX_TEXT);
    const refs = resolve(packSchema, get(evidence, 'properties.subcategoryIds'));
    expect([refs.minItems, refs.maxItems]).toEqual([1, MAX_SUBCATEGORY_REFS]);
    const validDays = resolve(packSchema, get(evidence, 'properties.validDays'));
    expect([validDays.type, validDays.minimum, validDays.maximum]).toEqual(['integer', 1, 3650]);
    const decision = resolve(packSchema, get(packSchema, 'properties.decisions.items'));
    expect(resolve(packSchema, get(decision, 'properties.reviewer')).maxLength).toBe(80);
    expect(resolve(packSchema, get(decision, 'properties.rationale')).maxLength).toBe(MAX_TEXT);
    expect(packSchema.required).toEqual(['schema', 'profile', 'evidence']);
    expect(evidence.required).toEqual(['id', 'title', 'type', 'subcategoryIds', 'collectedOn', 'validDays', 'scope', 'assertion', 'source']);
    expect(decision.required).toEqual(['subcategoryId', 'reviewer', 'verdict', 'rationale', 'decidedOn']);
  });

  it('types every date field as an ISO YYYY-MM-DD string', () => {
    const profile = resolve(packSchema, get(packSchema, 'properties.profile'));
    const evidence = resolve(packSchema, get(packSchema, 'properties.evidence.items'));
    const decision = resolve(packSchema, get(packSchema, 'properties.decisions.items'));
    for (const node of [get(profile, 'properties.asOf'), get(evidence, 'properties.collectedOn'), get(decision, 'properties.decidedOn')]) {
      expect(resolve(packSchema, node)).toMatchObject({ type: 'string', pattern: DATE_PATTERN });
    }
  });

  it('mirrors POLICY_BOUNDS and the canonical policy field list', () => {
    for (const root of [packSchema, reportSchema]) {
      const policy = resolve(root, get(root, 'properties.policy'));
      const prop = (k: string) => resolve(root, get(policy, `properties.${k}`));
      expect(policy.required).toEqual(Object.keys(DEFAULT_POLICY));
      expect(Object.keys(policy.properties as Dict)).toEqual(Object.keys(DEFAULT_POLICY));
      expect(prop('agingMultiplier')).toMatchObject({ minimum: POLICY_BOUNDS.agingMultiplier.min, maximum: POLICY_BOUNDS.agingMultiplier.max });
      for (const k of ['fresh', 'aging', 'stale']) {
        expect(resolve(root, get(prop('freshnessWeights'), `properties.${k}`))).toMatchObject({ minimum: POLICY_BOUNDS.weight.min, maximum: POLICY_BOUNDS.weight.max });
      }
      for (const k of ['full', 'partial']) {
        expect(resolve(root, get(prop('scopeWeights'), `properties.${k}`))).toMatchObject({ minimum: POLICY_BOUNDS.weight.min, maximum: POLICY_BOUNDS.weight.max });
      }
      expect(prop('freshnessWeights').required).toEqual(['fresh', 'aging', 'stale']);
      expect(prop('scopeWeights').required).toEqual(['full', 'partial']);
      expect(prop('sufficientCoverage')).toMatchObject({ minimum: POLICY_BOUNDS.sufficientCoverage.min, maximum: POLICY_BOUNDS.sufficientCoverage.max });
      expect(prop('minDistinctTypes')).toMatchObject({ minimum: POLICY_BOUNDS.minDistinctTypes.min, maximum: POLICY_BOUNDS.minDistinctTypes.max });
      expect([...(prop('exposure').required as string[])].sort()).toEqual([...STATUSES].sort());
      for (const s of STATUSES) {
        const node = resolve(root, get(prop('exposure'), `properties.${s}`));
        if (s === 'not-applicable') expect(node).toEqual({ const: 0 });
        else expect(node).toMatchObject({ minimum: POLICY_BOUNDS.exposure.min, maximum: POLICY_BOUNDS.exposure.max });
      }
      expect(prop('bands').required).toEqual(['moderate', 'high']);
      for (const k of ['moderate', 'high']) {
        expect(resolve(root, get(prop('bands'), `properties.${k}`))).toMatchObject({ minimum: POLICY_BOUNDS.band.min, maximum: POLICY_BOUNDS.band.max });
      }
      expect(prop('minOverrideRationale')).toMatchObject({ minimum: POLICY_BOUNDS.minOverrideRationale.min, maximum: POLICY_BOUNDS.minOverrideRationale.max });
      expect(prop('decisionValidDays')).toMatchObject({ minimum: POLICY_BOUNDS.decisionValidDays.min, maximum: POLICY_BOUNDS.decisionValidDays.max });
      expect(prop('separationOfDuties')).toEqual({ type: 'boolean' });
    }
  });
});

describe('report schema (tessera.report/1)', () => {
  const fixtureReport = buildReport(fixture);

  it('accepts the report built from the fixture, exactly as it is exported', () => {
    expect(conforms(reportSchema, json(fixtureReport))).toEqual([]);
    expect(fixtureReport.policyIsDefault).toBe(true);
  });

  it('accepts a report computed with a custom policy and a result carrying an override issue', () => {
    const custom = buildReport(customPack());
    expect(custom.policyIsDefault).toBe(false);
    expect(conforms(reportSchema, json(custom))).toEqual([]);
    const withIssue = json(custom) as { results: Dict[] };
    withIssue.results[0].overrideIssue = 'self-review';
    expect(conforms(reportSchema, withIssue)).toEqual([]);
    withIssue.results[0].overrideIssue = 'bogus';
    expect(conforms(reportSchema, withIssue).some((i) => /results\[0\]\.overrideIssue/.test(i))).toBe(true);
  });

  it('flags undeclared result keys, a missing disclaimer and an unknown status', () => {
    const r = json(fixtureReport) as { results: Dict[]; disclaimer?: string };
    r.results[0].score = 1;
    expect(conforms(reportSchema, r).some((i) => i.startsWith('results[0].score:'))).toBe(true);
    delete r.disclaimer;
    expect(conforms(reportSchema, r).some((i) => /missing required property disclaimer/.test(i))).toBe(true);
    r.results[1].status = 'green';
    expect(conforms(reportSchema, r).some((i) => /results\[1\]\.status: .*not in enum/.test(i))).toBe(true);
  });

  it('enumerates statuses, bands, freshness, override issues and priorities', () => {
    const result = resolve(reportSchema, get(reportSchema, 'properties.results.items'));
    const prop = (k: string) => resolve(reportSchema, get(result, `properties.${k}`));
    expect([...(prop('status').enum as string[])].sort()).toEqual([...STATUSES].sort());
    expect(prop('status').enum).toHaveLength(8);
    expect(prop('computedStatus').enum).toEqual(prop('status').enum);
    expect(prop('band').enum).toEqual(['low', 'moderate', 'high']);
    expect(prop('priority').enum).toEqual([1, 2, 3]);
    expect(prop('overrideIssue').enum).toEqual(['short-rationale', 'self-review']);
    expect(resolve(reportSchema, get(resolve(reportSchema, get(prop('evidence'), 'items')), 'properties.freshness')).enum).toEqual(['fresh', 'aging', 'stale']);
    const rollup = resolve(reportSchema, get(reportSchema, 'properties.rollups.items'));
    expect(resolve(reportSchema, get(rollup, 'properties.band')).enum).toEqual(['low', 'moderate', 'high', 'not-assessed']);
    expect(resolve(reportSchema, get(rollup, 'properties.fn')).enum).toEqual(['GV', 'ID', 'PR', 'DE', 'RS', 'RC']);
    expect(resolve(reportSchema, get(resolve(reportSchema, get(result, 'properties.decision')), 'properties.verdict')).enum).toEqual(VERDICTS);
  });

  it('requires every Report field including the embedded policy and policyIsDefault', () => {
    expect(reportSchema.required).toEqual(['schema', 'generatedFor', 'asOf', 'framework', 'subset', 'results', 'rollups', 'gaps', 'scoringNote', 'decisionPolicy', 'disclaimer', 'policy', 'policyIsDefault']);
    expect(Object.keys(reportSchema.properties as Dict).sort()).toEqual([...(reportSchema.required as string[])].sort());
    const result = resolve(reportSchema, get(reportSchema, 'properties.results.items'));
    expect(result.required).toEqual(['subcategoryId', 'status', 'computedStatus', 'coverage', 'distinctTypes', 'evidence', 'contradictions', 'priority', 'residual', 'band', 'override', 'overrideValid', 'reasons', 'warnings']);
    for (const optional of ['decision', 'decisionAgeDays', 'remediation', 'overrideIssue']) expect(get(result, `properties.${optional}`)).toBeDefined();
    expect(get(reportSchema, 'properties.gaps.items')).toEqual(get(reportSchema, 'properties.results.items'));
    expect(resolve(reportSchema, get(reportSchema, 'properties.asOf'))).toMatchObject({ type: 'string', pattern: DATE_PATTERN });
    expect(get(reportSchema, 'properties.policyIsDefault')).toEqual({ type: 'boolean' });
  });

  it('mirrors engine bounds: profile length, rationale length, evidence counts, subset size and the residual range', () => {
    expect(get(reportSchema, 'properties.generatedFor.maxLength')).toBe(MAX_SHORT);
    expect(get(reportSchema, 'properties.results.maxItems')).toBe(CATALOG.length);
    expect(get(reportSchema, 'properties.gaps.maxItems')).toBe(CATALOG.length);
    expect(get(reportSchema, 'properties.rollups.maxItems')).toBe(6);
    const result = resolve(reportSchema, get(reportSchema, 'properties.results.items'));
    const prop = (k: string) => resolve(reportSchema, get(result, `properties.${k}`));
    expect(prop('evidence').maxItems).toBe(MAX_EVIDENCE);
    expect(prop('contradictions').maxItems).toBe(MAX_EVIDENCE);
    expect(prop('residual')).toMatchObject({ type: 'number', minimum: 0, maximum: 3 });
    expect(prop('coverage')).toMatchObject({ type: 'number', minimum: 0 });
    expect(prop('distinctTypes')).toMatchObject({ type: 'integer', minimum: 0, maximum: EVIDENCE_TYPES.length });
    expect(prop('subcategoryId').enum).toEqual(CATALOG_ID_LIST);
    const assessment = resolve(reportSchema, get(prop('evidence'), 'items'));
    expect(resolve(reportSchema, get(assessment, 'properties.weight'))).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
    expect(resolve(reportSchema, get(assessment, 'properties.evidenceId')).maxLength).toBe(64);
    expect(resolve(reportSchema, get(prop('decision'), 'properties.rationale')).maxLength).toBe(MAX_TEXT);
    const rollup = resolve(reportSchema, get(reportSchema, 'properties.rollups.items'));
    expect(resolve(reportSchema, get(rollup, 'properties.meanResidual'))).toMatchObject({ type: ['number', 'null'], minimum: 0, maximum: 3 });
  });
});
