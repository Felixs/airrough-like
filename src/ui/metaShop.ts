import { MILESTONES, buyBoost, buyPerk, metaShop, type BoostId, type MetaState, type PerkId } from '../sim/meta';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface MetaShopHandlers {
  onChange(meta: MetaState): void;
  onStartRun(meta: MetaState): void;
}

/** Between Runs: spend Air Miles on Boosts and Starting Perks; Milestones show what they unlock. */
export function showMetaShop(root: HTMLElement, initial: MetaState, handlers: MetaShopHandlers): void {
  let meta = initial;
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Air Miles shop');
  root.appendChild(el);
  const render = (focus?: string) => {
    const shop = metaShop(meta);
    const item = (kind: 'boost' | 'perk', i: (typeof shop.boosts)[number]) => `
      <button type="button" class="offer" data-${kind}="${i.id}" ${i.available ? '' : 'disabled'} title="${esc(i.effect)}">
        <b>${esc(i.name)}${i.maxLevel > 1 ? ` ${i.level}/${i.maxLevel}` : ''}</b><span>${i.reason === 'Owned' || i.reason === 'Max level' ? i.reason : `✈ ${i.cost.toLocaleString('en-US')}`}</span>
        <small class="effect">${esc(i.effect)}</small></button>`;
    el.innerHTML = `
      <div class="card meta-card">
        <h2>Air Miles · ✈ ${meta.airMiles.toLocaleString('en-US')}</h2>
        <div class="meta-cols">
          <section><h3>Boosts</h3><div class="offers">${shop.boosts.map((b) => item('boost', b)).join('')}</div></section>
          <section><h3>Starting Perks</h3><div class="offers">${shop.perks.map((p) => item('perk', p)).join('')}</div>
            <h3 class="ms">Milestones</h3><ul class="milestones">${MILESTONES.map((m) => {
              const done = meta.milestones.includes(m.id);
              return `<li class="${done ? 'done' : ''}">${done ? '✓' : '○'} ${esc(m.name)} <small>unlocks ${esc(m.unlocks)}</small></li>`;
            }).join('')}</ul>
            <p class="lead">Large aircraft landed: ${meta.lifetime.largeLandings} · Runs: ${meta.lifetime.runs}</p></section>
        </div>
        <button type="button" class="primary" data-start>Start new Run</button>
      </div>`;
    (focus ? el.querySelector<HTMLButtonElement>(`[data-boost="${focus}"],[data-perk="${focus}"]`) : el.querySelector<HTMLButtonElement>('[data-start]'))?.focus();
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.dataset.start !== undefined) {
      el.remove();
      handlers.onStartRun(meta);
      return;
    }
    if (b.dataset.boost) meta = buyBoost(meta, b.dataset.boost as BoostId);
    else if (b.dataset.perk) meta = buyPerk(meta, b.dataset.perk as PerkId);
    else return;
    handlers.onChange(meta);
    render(b.dataset.boost ?? b.dataset.perk);
  });
  render();
}
