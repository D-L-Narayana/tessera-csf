import type { KeyboardEvent } from 'react';
import { CATALOG } from '../engine/catalog';
import type { CsfFunction, FunctionRollup, SubcategoryResult } from '../engine/types';

const FUNCTIONS: CsfFunction[] = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'];
const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']);
const HINT_ID = 'mosaic-nav-hint';

/** Tile ids per function row, in the order the mosaic renders them (function → category → catalog order). */
export function tileOrder(): string[][] {
  return FUNCTIONS.map((fn) => {
    const subs = CATALOG.filter((s) => s.fn === fn);
    const categories = [...new Set(subs.map((s) => s.category))];
    return categories.flatMap((cat) => subs.filter((s) => s.category === cat).map((s) => s.id));
  });
}

/**
 * Keyboard map for the roving tabindex. Arrow Right/Left walk the document order across categories and rows;
 * Arrow Down/Up move to the same index in the adjacent function row, clamped to that row's length; Home/End
 * jump to the first/last tile. Returns null when the key does nothing (edge of the grid, unknown key or id).
 */
export function nextTileId(rows: readonly (readonly string[])[], current: string, key: string): string | null {
  const row = rows.findIndex((r) => r.includes(current));
  if (row < 0) return null;
  const flat = rows.flat();
  const at = flat.indexOf(current);
  const col = rows[row].indexOf(current);
  const sameColumn = (r: readonly string[] | undefined): string | null => (r && r.length ? r[Math.min(col, r.length - 1)] : null);
  switch (key) {
    case 'ArrowRight':
      return at + 1 < flat.length ? flat[at + 1] : null;
    case 'ArrowLeft':
      return at > 0 ? flat[at - 1] : null;
    case 'ArrowDown':
      return sameColumn(rows[row + 1]);
    case 'ArrowUp':
      return row > 0 ? sameColumn(rows[row - 1]) : null;
    case 'Home':
      return flat.length ? flat[0] : null;
    case 'End':
      return flat.length ? flat[flat.length - 1] : null;
    default:
      return null;
  }
}

const ORDER = tileOrder();
const ALL_IDS = new Set(ORDER.flat());

interface Props {
  results: Map<string, SubcategoryResult>;
  selected: string | null;
  onSelect: (id: string) => void;
  rollups: FunctionRollup[];
}

export function Mosaic({ results, selected, onSelect, rollups }: Props) {
  // Roving tabindex: exactly one tile is in the Tab sequence — the selected tile, else the first tile.
  const focusable = selected && ALL_IDS.has(selected) ? selected : ORDER[0][0];

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!NAV_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); // arrow keys would otherwise scroll the page
    const target = nextTileId(ORDER, id, event.key);
    if (!target) return;
    // Focus only; Enter/Space still select through the native button. Browser API used inside the handler only.
    document.querySelector<HTMLElement>(`[data-tile-id="${target}"]`)?.focus();
  }

  return (
    <>
      <p id={HINT_ID} className="sr-only">Use arrow keys to move between tiles</p>
      <div className="mosaic" aria-describedby={HINT_ID}>
        {FUNCTIONS.map((fn) => {
          const subs = CATALOG.filter((s) => s.fn === fn);
          const roll = rollups.find((r) => r.fn === fn)!;
          const categories = [...new Set(subs.map((s) => s.category))];
          return (
            <section key={fn} className={`row row--${fn}`} role="group" aria-labelledby={`fn-${fn}`}>
              <header className="row__head">
                <h3 id={`fn-${fn}`}>
                  <span className="row__code">{fn}</span> {roll.functionName}
                </h3>
                <p className="row__roll">
                  {roll.sufficient}/{roll.count} sufficient ·{' '}
                  {roll.band === 'not-assessed' ? (
                    <span className="band band--not-assessed">not assessed (all scoped out)</span>
                  ) : (
                    <>
                      mean residual <span className={`band band--${roll.band}`}>{roll.meanResidual?.toFixed(2)}</span>
                      {roll.assessed < roll.count && <span className="muted"> over {roll.assessed} assessed</span>}
                    </>
                  )}
                </p>
              </header>
              <div className="row__cats">
                {categories.map((cat) => (
                  <div key={cat} className="cat">
                    <div className="cat__label" title={subs.find((s) => s.category === cat)!.categoryName}>
                      {cat}
                    </div>
                    <div className="cat__tiles">
                      {subs
                        .filter((s) => s.category === cat)
                        .map((s) => {
                          const r = results.get(s.id)!;
                          const isSel = selected === s.id;
                          const warn = r.warnings.length > 0;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`tile pat--${r.status} ${isSel ? 'is-selected' : ''} ${warn ? 'has-warning' : ''}`}
                              data-tile-id={s.id}
                              tabIndex={s.id === focusable ? 0 : -1}
                              aria-pressed={isSel}
                              aria-label={`${s.id}: ${r.status}, residual ${r.residual.toFixed(2)} (${r.band}), priority ${r.priority}${warn ? ', has reviewer warning' : ''}`}
                              onClick={() => onSelect(s.id)}
                              onKeyDown={(e) => moveFocus(e, s.id)}
                            >
                              <span className="tile__id">{s.id.slice(6)}</span>
                              <span className="tile__prio" aria-hidden="true">{'●'.repeat(r.priority)}</span>
                              {warn && <span className="tile__warn" aria-hidden="true">!</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
