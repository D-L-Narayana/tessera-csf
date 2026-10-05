// Validator hardening: optional rule policy with canonical output, evidence.collectedBy, control characters,
// blank strings, identifier whitespace, idempotence and round trips. The baseline messages and paths that
// tests/engine.test.ts relies on must stay exactly as they were; the last test pins them verbatim.
import { describe, expect, it } from 'vitest';
import fixture from '../src/fixtures/harbourline-pack.json';
import { DEFAULT_POLICY, isDefaultPolicy, POLICY_BOUNDS } from '../src/engine/policy';
import type { Decision, ValidationIssue } from '../src/engine/types';
import {
  MAX_ID,
  MAX_NAME,
  MAX_PACK_BYTES,
  MAX_SHORT,
  validatePack,
  validatePackObject,
  validatePolicyObject,
} from '../src/engine/validate';
import { AS_OF, ev, pack } from './helpers/pack';

/** The default policy values with every object's keys in a non-canonical order. */
const SHUFFLED_DEFAULT: Record<string, unknown> = {
  separationOfDuties: true,
  decisionValidDays: 365,
  bands: { high: 1.75, moderate: 0.75 },
  exposure: { 'not-applicable': 0, 'accepted-risk': 0.6, sufficient: 0.15, partial: 0.5, weak: 0.8, contradicted: 1, refuted: 1, none: 1 },
  minOverrideRationale: 40,
  minDistinctTypes: 2,
  sufficientCoverage: 1,
  scopeWeights: { partial: 0.5, full: 1 },
  freshnessWeights: { stale: 0, aging: 0.5, fresh: 1 },
  agingMultiplier: 1.5,
  schema: 'tessera.policy/1',
};

const dec = (patch: Partial<Decision> = {}): Decision => ({
  subcategoryId: 'PR.AA-05',
  reviewer: 'r.kaur',
  verdict: 'gap',
  rationale: 'Policy exists but is not enforced per interview.',
  decidedOn: AS_OF,
  ...patch,
});

function issuesOf(r: { ok: true } | { ok: false; issues: ValidationIssue[] }): ValidationIssue[] {
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.issues;
}

function expectIssue(issues: ValidationIssue[], path: string, message: RegExp): void {
  const hits = issues.filter((i) => i.path === path);
  expect(hits.length, `expected an issue at ${path}, got ${JSON.stringify(issues)}`).toBeGreaterThan(0);
  expect(hits.some((i) => message.test(i.message)), `messages at ${path}: ${hits.map((i) => i.message).join(' | ')}`).toBe(true);
}

describe('policy validation', () => {
  it('accepts a default-valued policy given in shuffled key order and rebuilds it in canonical order', () => {
    expect(JSON.stringify(SHUFFLED_DEFAULT)).not.toBe(JSON.stringify(DEFAULT_POLICY));
    const r = validatePolicyObject(SHUFFLED_DEFAULT);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.policy)).toBe(JSON.stringify(DEFAULT_POLICY));
    expect(Object.keys(r.policy)).toEqual(Object.keys(DEFAULT_POLICY));
    expect(Object.keys(r.policy.exposure)).toEqual(Object.keys(DEFAULT_POLICY.exposure));
    expect(isDefaultPolicy(r.policy)).toBe(true);
  });

  it('drops unknown policy keys and normalises -0 so the canonical form is stable', () => {
    const noisy = {
      ...SHUFFLED_DEFAULT,
      comment: 'not part of the policy',
      bands: { high: 1.75, moderate: 0.75, note: 'ignored' },
      exposure: { ...(SHUFFLED_DEFAULT.exposure as Record<string, number>), bogus: 0.5, 'not-applicable': -0 },
      freshnessWeights: { stale: 0, aging: 0.5, fresh: 1, extra: 1 },
    };
    const r = validatePolicyObject(noisy);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.policy)).toBe(JSON.stringify(DEFAULT_POLICY));
    expect(r.policy).toStrictEqual(DEFAULT_POLICY);
    expect(Object.is(r.policy.exposure['not-applicable'], 0)).toBe(true);
    expect('comment' in r.policy).toBe(false);
  });

  it('accepts every bound edge value', () => {
    const B = POLICY_BOUNDS;
    const low = {
      ...DEFAULT_POLICY,
      agingMultiplier: B.agingMultiplier.min,
      freshnessWeights: { fresh: 0, aging: 0, stale: 0 },
      scopeWeights: { full: 0, partial: 0 },
      sufficientCoverage: B.sufficientCoverage.min,
      minDistinctTypes: B.minDistinctTypes.min,
      exposure: { none: 0, refuted: 0, contradicted: 0, weak: 0, partial: 0, sufficient: 0, 'accepted-risk': 0, 'not-applicable': 0 },
      bands: { moderate: B.band.min, high: B.band.max },
      minOverrideRationale: B.minOverrideRationale.min,
      decisionValidDays: B.decisionValidDays.min,
      separationOfDuties: false,
    };
    const high = {
      ...DEFAULT_POLICY,
      agingMultiplier: B.agingMultiplier.max,
      freshnessWeights: { fresh: 1, aging: 1, stale: 1 },
      scopeWeights: { full: 1, partial: 1 },
      sufficientCoverage: B.sufficientCoverage.max,
      minDistinctTypes: B.minDistinctTypes.max,
      exposure: { none: 1, refuted: 1, contradicted: 1, weak: 1, partial: 1, sufficient: 1, 'accepted-risk': 1, 'not-applicable': 0 },
      bands: { moderate: 2.99, high: B.band.max },
      minOverrideRationale: B.minOverrideRationale.max,
      decisionValidDays: B.decisionValidDays.max,
    };
    for (const candidate of [low, high]) {
      const r = validatePolicyObject(candidate);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) expect(JSON.stringify(r.policy)).toBe(JSON.stringify(candidate));
    }
  });

  const REJECTED: [string, Record<string, unknown>, string][] = [
    ['agingMultiplier above the maximum (5.5)', { agingMultiplier: 5.5 }, 'policy.agingMultiplier'],
    ['agingMultiplier below the minimum (0.99)', { agingMultiplier: 0.99 }, 'policy.agingMultiplier'],
    ['agingMultiplier given as a string', { agingMultiplier: '1.5' }, 'policy.agingMultiplier'],
    ['bands.moderate greater than bands.high', { bands: { moderate: 1.75, high: 0.75 } }, 'policy.bands.high'],
    ['bands.moderate equal to bands.high', { bands: { moderate: 1, high: 1 } }, 'policy.bands.high'],
    ['bands.moderate below 0.01', { bands: { moderate: 0, high: 1 } }, 'policy.bands.moderate'],
    ['bands.high above 3', { bands: { moderate: 1, high: 3.01 } }, 'policy.bands.high'],
    ['bands missing', { bands: undefined }, 'policy.bands'],
    ['exposure.not-applicable other than 0', { exposure: { ...DEFAULT_POLICY.exposure, 'not-applicable': 0.1 } }, 'policy.exposure.not-applicable'],
    ['exposure.weak above 1', { exposure: { ...DEFAULT_POLICY.exposure, weak: 1.2 } }, 'policy.exposure.weak'],
    ['exposure.none negative', { exposure: { ...DEFAULT_POLICY.exposure, none: -0.1 } }, 'policy.exposure.none'],
    [
      'exposure missing a status',
      { exposure: Object.fromEntries(Object.entries(DEFAULT_POLICY.exposure).filter(([k]) => k !== 'partial')) },
      'policy.exposure.partial',
    ],
    ['exposure not an object', { exposure: [1, 1, 1, 0.8, 0.5, 0.15, 0.6, 0] }, 'policy.exposure'],
    ['minDistinctTypes 8', { minDistinctTypes: 8 }, 'policy.minDistinctTypes'],
    ['minDistinctTypes 0', { minDistinctTypes: 0 }, 'policy.minDistinctTypes'],
    ['minDistinctTypes not an integer', { minDistinctTypes: 1.5 }, 'policy.minDistinctTypes'],
    ['decisionValidDays 0', { decisionValidDays: 0 }, 'policy.decisionValidDays'],
    ['decisionValidDays 3651', { decisionValidDays: 3651 }, 'policy.decisionValidDays'],
    ['minOverrideRationale negative', { minOverrideRationale: -1 }, 'policy.minOverrideRationale'],
    ['minOverrideRationale above 2000', { minOverrideRationale: 2001 }, 'policy.minOverrideRationale'],
    ['sufficientCoverage below 0.1', { sufficientCoverage: 0.05 }, 'policy.sufficientCoverage'],
    ['sufficientCoverage above 10', { sufficientCoverage: 10.5 }, 'policy.sufficientCoverage'],
    ['sufficientCoverage NaN', { sufficientCoverage: Number.NaN }, 'policy.sufficientCoverage'],
    ['sufficientCoverage Infinity', { sufficientCoverage: Number.POSITIVE_INFINITY }, 'policy.sufficientCoverage'],
    ['schema tag wrong', { schema: 'tessera.policy/2' }, 'policy.schema'],
    ['schema tag missing', { schema: undefined }, 'policy.schema'],
    ['freshness aging greater than fresh', { freshnessWeights: { fresh: 0.5, aging: 0.8, stale: 0 } }, 'policy.freshnessWeights.aging'],
    ['freshness stale greater than aging', { freshnessWeights: { fresh: 1, aging: 0.2, stale: 0.3 } }, 'policy.freshnessWeights.stale'],
    ['freshness fresh above 1', { freshnessWeights: { fresh: 1.5, aging: 0.5, stale: 0 } }, 'policy.freshnessWeights.fresh'],
    ['freshnessWeights not an object', { freshnessWeights: [1, 0.5, 0] }, 'policy.freshnessWeights'],
    ['scope partial greater than full', { scopeWeights: { full: 0.5, partial: 0.6 } }, 'policy.scopeWeights.partial'],
    ['scope full above 1', { scopeWeights: { full: 1.5, partial: 0.5 } }, 'policy.scopeWeights.full'],
    ['separationOfDuties not a boolean', { separationOfDuties: 'yes' }, 'policy.separationOfDuties'],
  ];

  it.each(REJECTED)('rejects %s at the exact path', (_label, patch, path) => {
    const candidate = { ...DEFAULT_POLICY, ...patch };
    const direct = issuesOf(validatePolicyObject(candidate));
    expect(direct.map((i) => i.path), JSON.stringify(direct)).toContain(path);
    expect(direct.every((i) => i.path === 'policy' || i.path.startsWith('policy.'))).toBe(true);
    // The same object inside a pack (through JSON, so NaN/Infinity become null and undefined keys vanish).
    const viaPack = issuesOf(validatePack(JSON.stringify({ ...pack([ev({ id: 'E1' })]), policy: candidate })));
    expect(viaPack.map((i) => i.path), JSON.stringify(viaPack)).toContain(path);
  });

  it('reports policy problems with precise messages', () => {
    const issues = issuesOf(
      validatePolicyObject({
        ...DEFAULT_POLICY,
        schema: 'x',
        agingMultiplier: 9,
        minDistinctTypes: 8,
        exposure: { ...DEFAULT_POLICY.exposure, 'not-applicable': 0.2 },
        bands: { moderate: 2, high: 1 },
        separationOfDuties: 1,
      }),
    );
    expect(issues).toContainEqual({ path: 'policy.schema', message: "schema must be 'tessera.policy/1'" });
    expect(issues).toContainEqual({ path: 'policy.agingMultiplier', message: 'must be between 1 and 5' });
    expect(issues).toContainEqual({ path: 'policy.minDistinctTypes', message: 'must be an integer from 1 to 7' });
    expect(issues).toContainEqual({ path: 'policy.exposure.not-applicable', message: 'must be 0' });
    expect(issues).toContainEqual({ path: 'policy.bands.high', message: 'must be greater than bands.moderate' });
    expect(issues).toContainEqual({ path: 'policy.separationOfDuties', message: 'must be a boolean' });
  });

  it('rejects a policy that is not an object at path policy', () => {
    for (const bad of [null, [], 'tessera.policy/1', 42, true]) {
      expectIssue(issuesOf(validatePolicyObject(bad)), 'policy', /object/);
    }
    expectIssue(issuesOf(validatePackObject({ ...pack(), policy: null })), 'policy', /object/);
    expectIssue(issuesOf(validatePack(JSON.stringify({ ...pack(), policy: [] }))), 'policy', /object/);
  });

  it('embeds a validated policy in the pack in canonical order', () => {
    const r = validatePackObject({ ...pack([ev({ id: 'E1' })]), policy: { ...SHUFFLED_DEFAULT, extra: 1 } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.pack)).toEqual(['schema', 'profile', 'evidence', 'decisions', 'policy']);
    expect(JSON.stringify(r.pack.policy)).toBe(JSON.stringify(DEFAULT_POLICY));

    const custom = { ...DEFAULT_POLICY, decisionValidDays: 180, minOverrideRationale: 10 };
    const t = validatePack(JSON.stringify({ ...pack(), policy: custom }));
    expect(t.ok, JSON.stringify(t)).toBe(true);
    if (!t.ok) return;
    expect(t.pack.policy).toStrictEqual(custom);
    expect(isDefaultPolicy(t.pack.policy!)).toBe(false);
  });
});

describe('evidence.collectedBy', () => {
  it('keeps a valid collectedBy and omits the key when absent', () => {
    const r = validatePackObject(pack([ev({ id: 'E1', collectedBy: 'a.collector' }), ev({ id: 'E2' })]));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.pack.evidence[0].collectedBy).toBe('a.collector');
    expect('collectedBy' in r.pack.evidence[1]).toBe(false);
    expect(Object.keys(r.pack.evidence[1])).toEqual(['id', 'title', 'type', 'subcategoryIds', 'collectedOn', 'validDays', 'scope', 'assertion', 'source']);
  });

  it('rejects collectedBy that is too long, blank, non-string or contains control characters', () => {
    const issues = issuesOf(
      validatePackObject(
        pack([
          ev({ id: 'E1', collectedBy: 'x'.repeat(MAX_NAME + 1) }),
          ev({ id: 'E2', collectedBy: '   ' }),
          ev({ id: 'E3', collectedBy: 'a\u0007b' }),
          ev({ id: 'E4', collectedBy: 'x'.repeat(MAX_NAME) }),
          ev({ id: 'E5', collectedBy: 7 as unknown as string }),
        ]),
      ),
    );
    expectIssue(issues, 'evidence[0].collectedBy', new RegExp(`at most ${MAX_NAME} characters`));
    expectIssue(issues, 'evidence[1].collectedBy', /must not be blank/);
    expectIssue(issues, 'evidence[2].collectedBy', /must not contain control characters/);
    expect(issues.some((i) => i.path === 'evidence[3].collectedBy')).toBe(false);
    expectIssue(issues, 'evidence[4].collectedBy', /must be a string/);
  });
});

describe('control characters, blanks and identifier whitespace', () => {
  it('rejects control characters in title, id and reviewer with paths', () => {
    const issues = issuesOf(validatePackObject(pack([ev({ id: 'EV\u001b1', title: 'Bad\u0000title' })], [dec({ reviewer: 'r\u007fkaur' })])));
    expectIssue(issues, 'evidence[0].title', /must not contain control characters/);
    expectIssue(issues, 'evidence[0].id', /must not contain control characters/);
    expectIssue(issues, 'decisions[0].reviewer', /must not contain control characters/);
  });

  it('rejects control characters in source, subcategoryId and profile.name too', () => {
    const issues = issuesOf(
      validatePackObject(pack([ev({ id: 'E1', source: 'grc\n.example' })], [dec({ subcategoryId: 'PR.AA\t-05' })], { name: 'Prof\rile' })),
    );
    expectIssue(issues, 'evidence[0].source', /control characters/);
    expectIssue(issues, 'decisions[0].subcategoryId', /control characters/);
    expectIssue(issues, 'profile.name', /control characters/);
  });

  it('accepts newline and tab in note and rationale but not in short strings', () => {
    const note = 'Line one\nLine two\twith a tab';
    const rationale = 'Reason:\n- enforced\n- reviewed\t2026';
    const r = validatePackObject(pack([ev({ id: 'E1', note })], [dec({ rationale })]));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.pack.evidence[0].note).toBe(note);
      expect(r.pack.decisions[0].rationale).toBe(rationale);
    }
    expectIssue(issuesOf(validatePackObject(pack([ev({ id: 'E1', title: 'Two\nlines' })]))), 'evidence[0].title', /control characters/);
  });

  it('rejects other control characters in note and rationale', () => {
    const issues = issuesOf(validatePackObject(pack([ev({ id: 'E1', note: 'x\u0000y' })], [dec({ rationale: 'a\rb' })])));
    expectIssue(issues, 'evidence[0].note', /control characters/);
    expectIssue(issues, 'decisions[0].rationale', /control characters/);
  });

  it('rejects blank source, blank profile name and blank reviewer; an empty string keeps the length message', () => {
    const issues = issuesOf(validatePackObject(pack([ev({ id: 'E1', source: '   ' })], [dec({ reviewer: ' ' })], { name: ' ' })));
    expectIssue(issues, 'evidence[0].source', /must not be blank/);
    expectIssue(issues, 'decisions[0].reviewer', /must not be blank/);
    expectIssue(issues, 'profile.name', /must not be blank/);
    expectIssue(issuesOf(validatePackObject(pack([ev({ id: 'E1', source: '' })]))), 'evidence[0].source', /at least 1 character/);
  });

  it('rejects an id with leading or trailing whitespace but tolerates surrounding whitespace in a title', () => {
    const issues = issuesOf(validatePackObject(pack([ev({ id: ' EV-1' }), ev({ id: 'EV-2 ' }), ev({ id: 'EV-3', title: ' Spaced title ' })])));
    expectIssue(issues, 'evidence[0].id', /whitespace/);
    expectIssue(issues, 'evidence[1].id', /whitespace/);
    expect(issues.some((i) => i.path.startsWith('evidence[2]'))).toBe(false);
    const blank = issuesOf(validatePackObject(pack([ev({ id: '  ' })])));
    expect(blank.filter((i) => i.path === 'evidence[0].id').map((i) => i.message)).toEqual(['must not be blank']);
  });

  it('keeps the 50-issue cap', () => {
    const issues = issuesOf(validatePackObject(pack(Array.from({ length: 60 }, (_, i) => ev({ id: 'E' + i, title: 'bad\u0000' })))));
    expect(issues.length).toBe(50);
  });
});

describe('idempotence and round trips', () => {
  it('validatePackObject(validatePackObject(x).pack) deep-equals the first pack for the fixture', () => {
    const a = validatePackObject(fixture);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = validatePackObject(a.pack);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.pack).toStrictEqual(a.pack);
    expect(JSON.stringify(b.pack)).toBe(JSON.stringify(a.pack));
  });

  it('is idempotent for a pack with policy, notes, collectors and unknown keys at every level', () => {
    const rich = {
      schema: 'tessera.pack/1',
      extra: true,
      profile: { name: 'Rich profile', asOf: AS_OF, priorities: { 'PR.AA-05': 3 }, extra: 1 },
      evidence: [
        { ...ev({ id: 'E1', note: 'line\nnext\ttab', collectedBy: 'a.collector' }), extra: 'x' },
        { ...ev({ id: 'E2', type: 'report', collectedBy: 'b.collector' }) },
      ],
      decisions: [{ ...dec(), extra: [1] }],
      policy: { ...SHUFFLED_DEFAULT, bands: { high: 2, moderate: 1, extra: 0 }, extra: null },
    };
    const a = validatePackObject(rich);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    if (!a.ok) return;
    const b = validatePackObject(a.pack);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.pack).toStrictEqual(a.pack);
    expect(JSON.stringify(b.pack)).toBe(JSON.stringify(a.pack));
    expect(Object.keys(a.pack)).toEqual(['schema', 'profile', 'evidence', 'decisions', 'policy']);
    expect(Object.keys(a.pack.profile)).toEqual(['name', 'asOf', 'priorities']);
    expect(Object.keys(a.pack.evidence[0])).toEqual(['id', 'title', 'type', 'subcategoryIds', 'collectedOn', 'validDays', 'scope', 'assertion', 'source', 'note', 'collectedBy']);
    expect(Object.keys(a.pack.decisions[0])).toEqual(['subcategoryId', 'reviewer', 'verdict', 'rationale', 'decidedOn']);
    expect(Object.keys(a.pack.policy!)).toEqual(Object.keys(DEFAULT_POLICY));
    expect(a.pack.policy!.bands).toStrictEqual({ moderate: 1, high: 2 });
  });

  it('a pack without policy round-trips with no policy key', () => {
    const r = validatePackObject(pack([ev({ id: 'E1' })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('policy' in r.pack).toBe(false);
    expect(Object.keys(r.pack)).toEqual(['schema', 'profile', 'evidence', 'decisions']);
    expect(r.pack).toStrictEqual(pack([ev({ id: 'E1' })]));
    const t = validatePack(JSON.stringify(pack([ev({ id: 'E1' })])));
    expect(t.ok && !('policy' in t.pack)).toBe(true);
  });

  it('the bundled fixture still validates and round-trips byte-identically', () => {
    const text = JSON.stringify(fixture);
    const r = validatePack(text);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    // Byte identity is the real proof: nothing dropped, nothing added, nothing reordered.
    expect(JSON.stringify(r.pack)).toBe(text);
    expect('policy' in r.pack).toBe('policy' in fixture);
    expect(r.pack.evidence.length).toBe(fixture.evidence.length);
    expect(r.pack.decisions.length).toBe(fixture.decisions.length);
  });
});

describe('baseline messages and paths', () => {
  it('keeps the messages and paths the baseline suite relies on verbatim', () => {
    expect(validatePack('x'.repeat(MAX_PACK_BYTES + 1))).toEqual({ ok: false, issues: [{ path: '', message: `pack too large: limit is ${MAX_PACK_BYTES} bytes` }] });
    expect(validatePack('{nope')).toEqual({ ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] });
    expect(validatePackObject([])).toEqual({ ok: false, issues: [{ path: '', message: 'pack must be a JSON object' }] });

    const bad = {
      ...pack([ev({ id: 'E1', validDays: 0, collectedOn: '2026-13-01', subcategoryIds: ['PR.ZZ-99'] }), ev({ id: 'E1' })]),
      schema: 'other/9',
    };
    const issues = issuesOf(validatePackObject(bad));
    expect(issues).toContainEqual({ path: 'schema', message: "schema must be 'tessera.pack/1'" });
    expect(issues).toContainEqual({ path: 'evidence[0].validDays', message: 'validDays must be an integer from 1 to 3650' });
    expect(issues).toContainEqual({ path: 'evidence[0].collectedOn', message: 'must be an ISO date (YYYY-MM-DD)' });
    expect(issues).toContainEqual({ path: 'evidence[0].subcategoryIds[0]', message: 'unknown subcategory id in this subset: PR.ZZ-99' });
    expect(issues).toContainEqual({ path: 'evidence[1].id', message: 'duplicate evidence id E1' });

    const many = issuesOf(validatePackObject(pack(Array.from({ length: 501 }, (_, i) => ev({ id: 'E' + i })))));
    expect(many[0]).toEqual({ path: 'evidence', message: 'at most 500 evidence items are accepted' });

    const refs = issuesOf(validatePackObject(pack([ev({ id: 'E1', subcategoryIds: Array.from({ length: 26 }, () => 'PR.AA-05') })])));
    expect(refs).toContainEqual({ path: 'evidence[0].subcategoryIds', message: 'at most 25 subcategory references per evidence item' });

    const priorities: Record<string, 2> = {};
    for (let i = 0; i < 26; i++) priorities['PR.AA-' + String(i).padStart(2, '0')] = 2;
    const prio = issuesOf(validatePackObject(pack([], [], { priorities })));
    expect(prio).toContainEqual({ path: 'profile.priorities', message: 'at most 25 priority entries (one per subcategory in the subset)' });

    const long = issuesOf(validatePackObject(pack([ev({ id: 'x'.repeat(MAX_ID + 1), title: 'x'.repeat(MAX_SHORT + 1) })])));
    expect(long).toContainEqual({ path: 'evidence[0].id', message: `must be at most ${MAX_ID} characters` });
    expect(long).toContainEqual({ path: 'evidence[0].title', message: `must be at most ${MAX_SHORT} characters` });

    const dup = issuesOf(validatePackObject(pack([], [dec(), dec()])));
    expect(dup).toContainEqual({ path: 'decisions[1].subcategoryId', message: 'duplicate decision for the same subcategory' });
  });
});
