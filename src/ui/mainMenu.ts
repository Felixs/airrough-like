import { buyBoost, buyUnlockable, metaShop, type BoostId, type MetaState, type ShopItem, type UnlockableId } from '../sim/meta';
import type { RunState } from '../sim/run';
import type { Options } from '../sim/save';
import { dayName } from './dayEnd';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

type Tab = 'play' | 'shop' | 'options' | 'about';

export interface MainMenuHandlers {
  onContinue(): void;
  onNewRun(): void;
  onMeta(meta: MetaState): void;
  onOptions(options: Options): void;
  onResetProgress(): void;
}

/** The Main Menu: Continue · New Run · Unlockables & Boosts · Options · About. */
export function showMainMenu(root: HTMLElement, state: { meta: MetaState; saved: RunState | null; options: Options }, handlers: MainMenuHandlers): void {
  let { meta, options } = state;
  const saved = state.saved;
  let tab: Tab = 'play';
  let confirmReset = false;
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Main Menu');
  root.appendChild(el);

  const item = (kind: 'unlock' | 'boost', i: ShopItem) => `
    <button type="button" class="offer${i.locked ? ' locked' : ''}" data-${kind}="${i.id}" ${i.available ? '' : 'disabled'} title="${esc(i.effect)}">
      <b>${i.locked ? '🔒 ' : ''}${esc(i.name)}${i.maxLevel > 1 ? ` ${i.level}/${i.maxLevel}` : ''}</b>
      <span>${i.reason === 'Owned' ? '✓ Owned' : i.reason === 'Max level' ? 'Max' : `✈ ${i.cost.toLocaleString('en-US')}`}</span>
      <small class="effect">${esc(i.effect)}${i.reason && i.reason !== 'Owned' && i.reason !== 'Max level' ? ` · ${esc(i.reason)}` : ''}</small></button>`;

  const render = (focus?: string) => {
    const shop = metaShop(meta);
    const body: Record<Tab, () => string> = {
      play: () => `
        <div class="play">
          ${saved ? `<button type="button" class="primary big" data-go="continue">Continue<small>${saved.status === 'won' ? 'Won Run' : `Next: ${dayName(saved.week, saved.weekday)}`}${saved.endless ? ' · Endless' : ''} · ${money(saved.money)} · ${saved.stats.daysSurvived} Days survived</small></button>` : ''}
          <button type="button" class="${saved ? 'secondary' : 'primary'} big" data-go="new">New Run${saved ? '<small>Replaces the saved Run</small>' : ''}</button>
          <p class="lead">Survive four Weeks. Every Day has a Daily Quota of Movements, and missing one ends the Run. Spend Air Miles from finished Runs on Unlockables and Boosts.</p>
        </div>`,
      shop: () => `
        <div class="shop-cols">
          <section><h3>Unlockables <small>bought once, in every later Run</small></h3><div class="offers">${shop.unlockables.map((u) => item('unlock', u)).join('')}</div></section>
          <section><h3>Boosts <small>permanent bonuses in levels</small></h3><div class="offers">${shop.boosts.map((b) => item('boost', b)).join('')}</div></section>
        </div>`,
      options: () => `
        <div class="options">
          <label>Starting speed <select data-opt="defaultSpeed">${[1, 2, 4, 8].map((v) => `<option value="${v}"${options.defaultSpeed === v ? ' selected' : ''}>${v}×</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" data-opt="autoSlow" ${options.autoSlow ? 'checked' : ''}> Auto-slow: 1× while aircraft land or take off</label>
          <label class="check"><input type="checkbox" data-opt="eventPopups" ${options.eventPopups ? 'checked' : ''}> Pause with a pop-up on Incidents, Crashes and Diversions</label>
          <div class="danger-zone"><h3>Reset progress</h3><p class="lead">Deletes Air Miles, Unlockables, Boosts and the saved Run.</p>
            ${confirmReset ? '<button type="button" class="danger" data-go="reset-yes">Yes, delete everything</button> <button type="button" class="secondary small" data-go="reset-no">Cancel</button>' : '<button type="button" class="secondary small" data-go="reset">Reset progress…</button>'}</div>
        </div>`,
      about: () => `
        <div class="about">
          <h3>How to play</h3>
          <ol>
            <li><b>Plan Mode</b>: before each Day, read the Forecast and Run Calendar, buy upgrades and use <b>Build</b> to add Taxiways, Stands, Holding Bays, Runways and buildings. Demolish refunds everything for now, so experiment.</li>
            <li><b>Live Day</b>: the ATC Tower handles every aircraft by itself. Watch the Quota bar, the Holding strips (fuel!) and the Alerts. Use <b>Emergency Actions</b> when an aircraft runs low on fuel or the ground jams.</li>
            <li><b>Daily Quota</b>: every landing and takeoff is a Movement. Miss the Quota once and the Run is over. Saturdays are Rush Days, Sundays Boss Days with a Boss Twist you can see coming in the Run Calendar.</li>
            <li><b>Money</b>: aircraft pay when they unload and when they take off. Upkeep is paid at midnight. You may go into Debt, but then you can't build.</li>
            <li><b>Between Runs</b>: the Air Miles you earn buy Unlockables (buildings and features) and Boosts.</li>
          </ol>
          <h3>About</h3>
          <p class="lead">Airport Auto Battler: a roguelite about running an airport. Designed by Felix, built with Claude. Aircraft art and callsigns are fictional flavour.</p>
        </div>`,
    };
    el.innerHTML = `
      <div class="menu-card">
        <header><h1>Airport Auto Battler</h1><span class="miles" title="Air Miles">✈ ${meta.airMiles.toLocaleString('en-US')}</span></header>
        <nav class="tabs" role="tablist">${(['play', 'shop', 'options', 'about'] as Tab[]).map((t) => `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === tab}">${{ play: 'Play', shop: 'Unlockables & Boosts', options: 'Options', about: 'About' }[t]}</button>`).join('')}</nav>
        <div class="menu-body">${body[tab]()}</div>
      </div>`;
    const target = focus ? el.querySelector<HTMLElement>(`[data-unlock="${focus}"],[data-boost="${focus}"]`) : el.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    target?.focus();
  };

  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.dataset.tab) {
      tab = b.dataset.tab as Tab;
      confirmReset = false;
      render();
      return;
    }
    const go = b.dataset.go;
    if (go === 'continue' || go === 'new') {
      el.remove();
      (go === 'continue' ? handlers.onContinue : handlers.onNewRun)();
      return;
    }
    if (go === 'reset') confirmReset = true;
    if (go === 'reset-no') confirmReset = false;
    if (go === 'reset-yes') {
      el.remove();
      handlers.onResetProgress();
      return;
    }
    if (b.dataset.unlock) meta = buyUnlockable(meta, b.dataset.unlock as UnlockableId);
    if (b.dataset.boost) meta = buyBoost(meta, b.dataset.boost as BoostId);
    if (b.dataset.unlock || b.dataset.boost) handlers.onMeta(meta);
    render(b.dataset.unlock ?? b.dataset.boost);
  });
  el.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    const key = input.dataset.opt as keyof Options | undefined;
    if (!key) return;
    options = key === 'defaultSpeed'
      ? { ...options, defaultSpeed: Number(input.value) as Options['defaultSpeed'] }
      : { ...options, [key]: (input as HTMLInputElement).checked };
    handlers.onOptions(options);
  });
  render();
}
