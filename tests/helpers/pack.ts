// Shared test builders. Same shapes as the builders in tests/engine.test.ts so new suites read the same way.
import type { Decision, Evidence, EvidencePack, Profile } from '../../src/engine/types';

export const AS_OF = '2026-10-01';

export function ev(partial: Partial<Evidence> & { id: string }): Evidence {
  return {
    title: 'Evidence ' + partial.id,
    type: 'policy',
    subcategoryIds: ['PR.AA-05'],
    collectedOn: '2026-09-01',
    validDays: 365,
    scope: 'full',
    assertion: 'supports',
    source: 'grc.example',
    ...partial,
  };
}

export function pack(evidence: Evidence[] = [], decisions: Decision[] = [], profilePatch: Partial<Profile> = {}): EvidencePack {
  return {
    schema: 'tessera.pack/1',
    profile: { name: 'Test profile', asOf: AS_OF, priorities: {}, ...profilePatch },
    evidence,
    decisions,
  };
}
