import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { forecast } from '../src/engine/forecast';
import type { Decision, EvidencePack } from '../src/engine/types';
import { validatePack } from '../src/engine/validate';
import fixture from '../src/fixtures/harbourline-pack.json';
import { Horizon } from '../src/ui/Horizon';
import { ev, pack } from './helpers/pack';

function fixturePack(): EvidencePack {
  const r = validatePack(JSON.stringify(fixture));
  if (!r.ok) throw new Error('bundled fixture failed validation: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return r.pack;
}

function render(p: EvidencePack): string {
  return renderToStaticMarkup(<Horizon pack={p} onSelect={() => undefined} />);
}

interface Btn {
  attrs: string;
  name: string; // accessible name as computed from content (tags stripped, whitespace collapsed)
}

function textOf(inner: string): string {
  return inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function buttons(html: string): Btn[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1] ?? '', name: textOf(m[2] ?? '') }));
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('Horizon panel — bundled fixture at the default 90-day horizon', () => {
  const fx = fixturePack();
  const html = render(fx);
  const fc = forecast(fx, 90);

  it('renders a section headed exactly "Horizon" and labelled by that heading', () => {
    const m = /<h2 id="([^"]+)">Horizon<\/h2>/.exec(html);
    expect(m).not.toBeNull();
    const id = m?.[1] ?? '';
    expect(html).toMatch(new RegExp(`<section[^>]*aria-labelledby="${esc(id)}"`));
  });

  it('offers a select labelled "Horizon (days)" with 30/60/90/180 and 90 preselected', () => {
    const label = /<label\b[^>]*\bfor="([^"]+)"[^>]*>Horizon \(days\)<\/label>/.exec(html);
    expect(label).not.toBeNull();
    const id = label?.[1] ?? '';
    expect(id.length).toBeGreaterThan(0);
    expect(html).toMatch(new RegExp(`<select\\b[^>]*\\bid="${esc(id)}"[^>]*>`));
    for (const h of [30, 60, 90, 180]) {
      const opt = new RegExp(`<option[^>]*value="${h}"[^>]*>${h}</option>`).exec(html);
      expect(opt).not.toBeNull();
      expect(/\bselected\b/.test(opt?.[0] ?? '')).toBe(h === 90);
    }
  });

  it('renders the three sub-headings with exact text', () => {
    for (const t of ['Evidence expiring', 'Decisions lapsing', 'Outcomes projected to change']) {
      expect(html).toMatch(new RegExp(`<h3 id="[^"]+">${esc(t)}</h3>`));
    }
  });

  it('lists EV-003 and EV-007 at 90 days and omits artifacts that are already stale', () => {
    expect(fc.evidence.map((e) => e.evidenceId)).toContain('EV-003');
    expect(html).toContain('EV-003');
    expect(html).toContain('EV-007');
    expect(html).toContain('aging on 2026-12-22');
    for (const stale of ['EV-006', 'EV-009', 'EV-019']) expect(html).not.toContain(stale);
    expect(html).toContain(`${fc.evidence.length} of ${fx.evidence.length} artifacts cross a freshness boundary by 2026-12-30.`);
  });

  it('shows the decisions empty state for the fixture while the other two lists are populated', () => {
    expect(fc.decisions).toEqual([]);
    expect(html).toContain('No applied decision lapses within 90 days.');
    expect(html).not.toContain('Nothing crosses a freshness boundary within 90 days.');
    expect(html).not.toContain('No outcome is projected to change within 90 days.');
  });

  it('renders one linkish button per row, each with an accessible name that includes the target outcome', () => {
    const rows = buttons(html);
    expect(rows.length).toBe(fc.evidence.length + fc.decisions.length + fc.outcomes.length);
    expect(rows.length).toBeGreaterThan(5);
    for (const b of rows) {
      expect(b.attrs).toMatch(/\btype="button"/);
      expect(b.attrs).toMatch(/\bclass="[^"]*\blinkish\b/);
      expect(b.name.length).toBeGreaterThan(0);
    }
    expect(rows.map((b) => b.name)).toContain('EV-007 Monthly patch compliance report for PR.PS-02');
  });

  it('shows PR.PS-02 projected from sufficient to weak and labelled worsens', () => {
    expect(buttons(html).map((b) => b.name)).toContain('PR.PS-02 sufficient → weak');
    expect(html).toContain('residual 0.45 → 2.40');
    expect(html).toMatch(/<span class="chip horizon__change horizon__change--worsens">worsens<\/span>/);
    expect(html).not.toContain('>improves<');
  });

  it('states the projection assumption', () => {
    expect(html).toContain('Projections assume no new evidence is added and no decision is changed.');
  });

  it('uses no inline styles or style elements', () => {
    expect(html).not.toMatch(/ style=/);
    expect(html).not.toMatch(/<style/i);
  });

  it('colours function codes with the shared fn classes', () => {
    expect(html).toContain('<span class="fn fn--PR">PR.PS-02</span>');
    expect(html).toContain('<span class="fn fn--GV">GV.OC-03</span>');
  });
});

describe('Horizon panel — custom packs', () => {
  it('renders all three empty states for an empty pack', () => {
    const html = render(pack());
    expect(html).toContain('Nothing crosses a freshness boundary within 90 days.');
    expect(html).toContain('No applied decision lapses within 90 days.');
    expect(html).toContain('No outcome is projected to change within 90 days.');
    expect(buttons(html)).toEqual([]);
  });

  it('selects the first outcome of a multi-outcome artifact and lists the others', () => {
    const p = pack([
      ev({ id: 'EV-100', title: 'Asset management procedure', type: 'procedure', subcategoryIds: ['ID.AM-01', 'ID.AM-02'], collectedOn: '2026-09-01', validDays: 45 }),
    ]);
    const html = render(p);
    expect(buttons(html).map((b) => b.name)).toContain('EV-100 Asset management procedure for ID.AM-01');
    expect(html).toContain('also ID.AM-02');
    expect(html).toContain('<span class="fn fn--ID">ID.AM-01</span>');
    expect(html).toContain('aging on 2026-10-17');
  });

  it('lists a lapsing decision with reviewer and dates and marks its outcome as improving', () => {
    const gap: Decision = {
      subcategoryId: 'PR.AA-05',
      reviewer: 'r.kaur',
      verdict: 'gap',
      rationale: 'Policy exists but is not enforced per interview.',
      decidedOn: '2025-10-01',
    };
    const p = pack([ev({ id: 'E1', type: 'policy' }), ev({ id: 'E2', type: 'configuration' })], [gap]);
    const html = render(p);
    const names = buttons(html).map((b) => b.name);
    expect(names).toContain('PR.AA-05 gap by r.kaur');
    expect(html).toContain('decided 2025-10-01');
    expect(html).toContain('lapses on 2026-10-02 (in 1 d)');
    expect(names).toContain('PR.AA-05 weak → sufficient');
    expect(html).toMatch(/<span class="chip horizon__change horizon__change--improves">improves<\/span>/);
    expect(html).not.toContain('No applied decision lapses within 90 days.');
  });
});
