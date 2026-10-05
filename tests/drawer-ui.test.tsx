import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOG } from '../src/engine/catalog';
import { buildReport } from '../src/engine/evaluate';
import { DEFAULT_POLICY } from '../src/engine/policy';
import { EVIDENCE_TYPES } from '../src/engine/types';
import type { EvidencePack, Subcategory } from '../src/engine/types';
import { validatePack } from '../src/engine/validate';
import fixture from '../src/fixtures/harbourline-pack.json';
import { DecisionForm } from '../src/ui/DecisionForm';
import { Drawer } from '../src/ui/Drawer';
import { EvidenceForm } from '../src/ui/EvidenceForm';

const validated = validatePack(JSON.stringify(fixture));
if (!validated.ok) throw new Error('bundled fixture must validate');
const fixturePack: EvidencePack = validated.pack;
const report = buildReport(fixturePack);

const subById = (id: string): Subcategory => CATALOG.find((s) => s.id === id)!;
const resultById = (id: string) => report.results.find((r) => r.subcategoryId === id)!;
const noop = () => {};
const ok = () => null;

type DrawerProps = Parameters<typeof Drawer>[0];

function renderDrawer(id: string, extra: Partial<DrawerProps> = {}): string {
  return renderToStaticMarkup(
    <Drawer
      sub={subById(id)}
      result={resultById(id)}
      pack={fixturePack}
      evidenceTypes={EVIDENCE_TYPES}
      policy={DEFAULT_POLICY}
      onAddEvidence={ok}
      onUpdateEvidence={ok}
      onRemoveEvidence={noop}
      onDecision={noop}
      onPriority={noop}
      onClose={noop}
      {...extra}
    />,
  );
}

/** Bare `id="…"` attribute values (a leading space excludes data-*-id and aria-* attributes). */
const idValues = (html: string): string[] => [...html.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
const forTargets = (html: string): string[] => [...html.matchAll(/ for="([^"]*)"/g)].map((m) => m[1]);
const controls = (html: string): string[] => html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];

function expectAccessibleMarkup(html: string): void {
  const ids = idValues(html);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  const targets = new Set(forTargets(html));
  for (const t of targets) expect(ids).toContain(t);
  // Every form control is associated with a <label for> through a generated id.
  for (const c of controls(html)) {
    const m = / id="([^"]*)"/.exec(c);
    expect(m, `control without id: ${c}`).not.toBeNull();
    expect(targets.has(m![1]), `control without label: ${c}`).toBe(true);
  }
  expect(html).not.toMatch(/ style=/);
  expect(html).not.toContain('id="prio"');
}

describe('Drawer for PR.DS-11 (contradicted fixture outcome)', () => {
  const html = renderDrawer('PR.DS-11');

  it('keeps the baseline structure, selectors and labels', () => {
    expect(html).toMatch(/<h2 class="drawer__id">PR\.DS-11<\/h2>/);
    expect(html).toMatch(/<dl class="facts">/);
    expect(html).toMatch(/class="status status--contradicted"/);
    expect(html).toMatch(/class="warnbox"/);
    expect(html).toContain('acceptance ignored while evidence is contradicted');
    expect(html).toMatch(/class="remediation"/);
    expect(html).toMatch(/<details class="trace" open=""/);
    expect(html).toContain('aria-label="Close outcome details"');
    for (const label of ['Title', 'Source system', 'Type', 'Collected on', 'Valid for (days)', 'Scope', 'Assertion', 'Reviewer', 'Verdict']) {
      expect(html, `label ${label}`).toContain(`<span>${label}</span>`);
    }
    expect(html).toMatch(/>Rationale <span class="counter/);
    expect(html).toContain('>Record decision</button>');
    expect(html).toContain('>Clear decision</button>');
  });

  it('offers Edit and Remove per artifact and shows the freshness boundary dates', () => {
    for (const id of ['EV-004', 'EV-005']) {
      expect(html).toMatch(new RegExp(`<button type="button"[^>]*>Edit ${id}</button>`));
      expect(html).toMatch(new RegExp(`<button type="button"[^>]*>Remove ${id}</button>`));
    }
    expect(html).toContain('aging on 2026-12-15 · stale on 2027-01-29');
    expect((html.match(/aging on \d{4}-\d{2}-\d{2} · stale on \d{4}-\d{2}-\d{2}/g) ?? []).length).toBe(2);
  });

  it('renders the add form with the next free id and the new fields', () => {
    expect(html).toContain('Add evidence for PR.DS-11');
    expect(html).toContain('Id: EV-023');
    expect(html).toContain('Collected by');
    expect(html).toContain('<span>Note');
    expect(html).toContain('<legend>Also applies to</legend>');
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes.length).toBe(24);
    expect(boxes.some((b) => b.includes('value="PR.DS-11"'))).toBe(false);
    expect(html).toContain('>Add evidence</button>');
    expect(html).not.toContain('Save changes');
    expect(html).not.toContain('Cancel edit');
  });

  it('renders the decision form with a live preview and policy-derived numbers', () => {
    expect(html).toContain('aria-live="polite"');
    const at = html.indexOf('Decision preview');
    expect(at).toBeGreaterThan(-1);
    const preview = html.slice(at);
    expect(preview).toContain('class="status status--contradicted"');
    expect(preview).toContain('acceptance ignored while evidence is contradicted');
    expect(html).toContain('This decision will be dated 2026-10-01 and lapses on 2027-10-02.');
    expect(html).toContain('needs at least 40 characters');
    expect(html).toContain('Decisions expire after 365 days');
    expect(html).toContain('value="m.okafor"');
  });

  it('labels every control through generated ids, with no duplicate ids and no inline styles', () => {
    expectAccessibleMarkup(html);
    const prio = /<label for="([^"]+)">Priority<\/label>/.exec(html);
    expect(prio).not.toBeNull();
    expect(html).toContain(`<select id="${prio![1]}"`);
  });
});

describe('Drawer policy and reviewer defaults', () => {
  it('uses the supplied policy for the counter, lapse date, disclaimer and preview', () => {
    const html = renderDrawer('DE.CM-01', { policy: { ...DEFAULT_POLICY, minOverrideRationale: 10, decisionValidDays: 180 }, defaultReviewer: 'r.kaur' });
    expect(html).toContain('/ 10 min for accepted');
    expect(html).toContain('needs at least 10 characters');
    expect(html).toContain('Decisions expire after 180 days');
    expect(html).toContain('This decision will be dated 2026-10-01 and lapses on 2027-03-31.');
    expect(html).toContain('value="r.kaur"');
    expect(html).not.toContain('Clear decision');
    const preview = html.slice(html.indexOf('Decision preview'));
    expect(preview).toContain('class="status status--none"');
    expect(preview).toContain('override rationale too short; computed status kept');
    expectAccessibleMarkup(html);
  });

  it('falls back to the legacy minRationale prop when no policy is given', () => {
    const html = renderToStaticMarkup(
      <Drawer
        sub={subById('GV.PO-01')}
        result={resultById('GV.PO-01')}
        pack={fixturePack}
        evidenceTypes={EVIDENCE_TYPES}
        minRationale={12}
        onAddEvidence={ok}
        onRemoveEvidence={noop}
        onDecision={noop}
        onPriority={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain('needs at least 12 characters');
    expect(html).toContain('/ 12 min for accepted');
    expect(html).toContain('Decisions expire after 365 days');
    expect(html).toContain('Edit EV-010');
  });

  it('keeps the empty-evidence hint for an outcome without artifacts', () => {
    const html = renderDrawer('RC.RP-01');
    expect(html).toContain('No evidence references this outcome yet. Add one below.');
    expect(html).toContain('Add evidence for RC.RP-01');
    expect(html).not.toContain('aging on');
  });
});

describe('EvidenceForm', () => {
  const sub = subById('PR.AA-05');
  const ev1 = fixturePack.evidence.find((e) => e.id === 'EV-001')!;

  it('edits an artifact with its id preserved and its values prefilled', () => {
    const html = renderToStaticMarkup(<EvidenceForm sub={sub} pack={fixturePack} types={EVIDENCE_TYPES} editing={ev1} onSubmit={ok} onCancel={noop} />);
    expect(html).toContain('Edit evidence EV-001');
    expect(html).toContain('Id: EV-001');
    expect(html).toContain('>Save changes</button>');
    expect(html).toContain('>Cancel edit</button>');
    expect(html).not.toContain('Add evidence');
    expect(html).toContain('value="Access control policy v4 (approved)"');
    expect(html).toContain('Signed by CIO 2026-08-10; covers least privilege and SoD.</textarea>');
    expect(html).toMatch(/<option value="policy" selected=""/);
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes.length).toBe(24);
    expect(boxes.some((b) => b.includes('value="PR.AA-05"'))).toBe(false);
    expect(boxes.find((b) => b.includes('value="PR.AA-01"'))).toContain('checked=""');
    expect(boxes.filter((b) => b.includes('checked=""')).length).toBe(1);
    expectAccessibleMarkup(html);
  });

  it('adds with the next free id, the evaluation date and bounded optional fields', () => {
    const html = renderToStaticMarkup(<EvidenceForm sub={sub} pack={fixturePack} types={EVIDENCE_TYPES} onSubmit={ok} />);
    expect(html).toContain('Add evidence for PR.AA-05');
    expect(html).toContain('Id: EV-023');
    expect(html).toContain('>Add evidence</button>');
    expect(html).not.toContain('Cancel edit');
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-10-01"/);
    expect(html).toMatch(/<textarea[^>]*maxlength="2000"/i); // React serialises the attribute as maxLength
    for (const t of EVIDENCE_TYPES) expect(html).toMatch(new RegExp(`<option value="${t}"( selected="")?>${t}</option>`));
    expect(html).toContain('<form class="addform"');
    expectAccessibleMarkup(html);
  });
});

describe('DecisionForm', () => {
  const sub = subById('PR.AA-05');

  it('previews an existing decision and states the dating and lapse rule', () => {
    const existing = { subcategoryId: 'PR.AA-05', reviewer: 'm.okafor', verdict: 'gap' as const, rationale: 'Policy not enforced per interview.', decidedOn: '2026-09-30' };
    const html = renderToStaticMarkup(<DecisionForm sub={sub} existing={existing} policy={DEFAULT_POLICY} asOf="2026-10-01" pack={fixturePack} onDecision={noop} />);
    expect(html).toContain('<form class="decision"');
    expect(html).toContain('value="m.okafor"');
    expect(html).toMatch(/<option value="gap" selected=""/);
    expect(html).toContain('Policy not enforced per interview.</textarea>');
    expect(html).toContain('>Clear decision</button>');
    expect(html).toContain('This decision will be dated 2026-10-01 and lapses on 2027-10-02.');
    const preview = html.slice(html.indexOf('Decision preview'));
    expect(preview).toContain('class="status status--weak"');
    expectAccessibleMarkup(html);
  });

  it('starts from the default reviewer and shows a clean preview for an accepted sufficient outcome', () => {
    const html = renderToStaticMarkup(<DecisionForm sub={sub} policy={DEFAULT_POLICY} asOf="2026-10-01" defaultReviewer="r.kaur" pack={fixturePack} onDecision={noop} />);
    expect(html).toContain('value="r.kaur"');
    expect(html).not.toContain('Clear decision');
    const preview = html.slice(html.indexOf('Decision preview'));
    expect(preview).toContain('class="status status--sufficient"');
    expect(preview).toContain('No refusals');
    expect(preview).not.toContain('<li>');
  });
});
