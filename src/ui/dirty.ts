// Unsaved-changes tracking. A pack is "clean" when its canonical form equals the form that was last exported.
import type { EvidencePack } from '../engine/types';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = canonical(source[key]);
    }
    return out;
  }
  return value;
}

/** Canonical JSON of the pack: object keys sorted at every level, undefined fields dropped, array order kept. */
export function fingerprint(pack: EvidencePack): string {
  return JSON.stringify(canonical(pack));
}

/** True when nothing has been exported yet, or when the pack differs from the last exported fingerprint. */
export function isDirty(pack: EvidencePack, exportedFingerprint: string | null): boolean {
  return exportedFingerprint === null || fingerprint(pack) !== exportedFingerprint;
}
