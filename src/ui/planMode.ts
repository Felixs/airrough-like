import { upgradeOffers, runCalendar, suggestions, type UpgradeId } from '../sim/plan';
import { BONUS_TWIST_SCORE_PER_WEEK, canTakeBonusTwist, dayPlan, dayTwists, upkeep, type RunState } from '../sim/run';
import { FAMILY_NAME, type Twist } from '../sim/twists';
import { WEEKDAY_NAMES } from '../sim/schedule';
import { mountBuildMode, type BuildModeView } from './buildMode';
import { dayName } from './dayEnd';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const ICON: Record<Twist['family'], string> = { weather: '☁', infrastructure: '⚠', surge: '▲' };
const REASON: Record<string, string> = { noFittingRunway: 'Runway too short', noFittingStand: 'No Stand of their size', standCapacity: 'Not enough Stands' };

export interface PlanModeHandlers {
  /** Buys an upgrade and returns the updated Run (or throws with a reason). */
  onBuy(id: UpgradeId): RunState;
  /** Build Mode confirmed changes. */
  onBuilt(run: RunState): void;
  /** Turns the next Day's Bonus Twist on or off; returns the updated Run. */
  onBonusTwist(on: boolean): RunState;
  onStartDay(): void;
}

/** Plan Mode · Overview between Days (UI baseline direction B). */
export function showPlanMode(root: HTMLElement, initial: RunState, handlers: PlanModeHandlers): void {
  let run = initial;
  const el = document.createElement('div');
  el.className = 'plan';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Plan Mode');
  root.appendChild(el);
  let tab: 'overview' | 'build' = 'overview';
  let build: BuildModeView | null = null;

  const render = (focusId?: string) => {
    build?.destroy();
    build = null;
    const plan = dayPlan(run);
    const f = plan.forecast;
    const last = run.history[run.history.length - 1];
    const calendar = runCalendar(run);
    const boss = calendar.find((w) => w.week === run.week)?.days[6];
    const offers = upgradeOffers(run);
    const tips = suggestions(run);
    const turned = Object.entries(f.turnedAway).filter(([k, v]) => k !== 'total' && v > 0);
    const twists = dayTwists(run);

    el.innerHTML = `
      <header class="plan-head">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" data-tab="overview" aria-selected="${tab === 'overview'}">Overview</button>
          <button type="button" role="tab" data-tab="build" aria-selected="${tab === 'build'}">Build</button>
        </div>
        <span class="next">${run.endless ? '<b class="endless">Endless</b> · ' : ''}Next: <b>${dayName(run.week, run.weekday)}</b>${plan.weekday === 6 ? ' · Boss Day' : plan.weekday === 5 ? ' · Rush Day' : ''}</span>
        <span class="spacer"></span>
        <span class="money${run.inDebt ? ' debt' : ''}" title="Upkeep ${money(upkeep(run))} per Day, paid at 24:00">${money(run.money)}</span>
        <button type="button" class="start">Start Day ▶</button>
      </header>
      ${tab === 'build' ? '<div class="plan-build"></div>' : `<div class="plan-body">
        <section class="col">
          ${last ? `<div class="card"><h3>Last Day · ${dayName(last.week, last.weekday)}</h3><dl>
            <dt>Movements / Quota</dt><dd>${last.movements} / ${last.quota}</dd>
            <dt>Fees</dt><dd>${money(last.fees)}</dd>
            <dt>Upkeep</dt><dd>${money(-last.upkeep)}</dd>
            <dt>Fines & Incidents</dt><dd>${money(-last.penalties)}</dd>
            <dt>Crashes · Diversions</dt><dd>${last.crashes} · ${last.diversions}</dd></dl></div>` : ''}
          <div class="card"><h3>Forecast · ${dayName(run.week, run.weekday)}</h3><dl>
            ${twists.map((t) => `<dt>Twist</dt><dd class="twist" title="${esc(t.description)}">${ICON[t.family]} ${esc(t.name)}</dd>`).join('')}
            <dt>Daily Quota</dt><dd><b>${f.quota}</b> Movements</dd>
            <dt>Demand</dt><dd>${f.demand} flights</dd>
            <dt>Arriving</dt><dd>S ${f.arrivalsBySize.small} · M ${f.arrivalsBySize.medium} · L ${f.arrivalsBySize.large}</dd>
            <dt class="sub">Passenger</dt><dd title="Need Terminal Stands">S ${f.arrivalsByPurpose.passenger.small} · M ${f.arrivalsByPurpose.passenger.medium} · L ${f.arrivalsByPurpose.passenger.large}</dd>
            <dt class="sub">Cargo</dt><dd title="Need Cargo Hub Stands">S ${f.arrivalsByPurpose.cargo.small} · M ${f.arrivalsByPurpose.cargo.medium} · L ${f.arrivalsByPurpose.cargo.large}</dd>
            <dt>Peak hour</dt><dd>${String(f.peakHour).padStart(2, '0')}:00</dd>
            <dt>Turned away</dt><dd>${f.turnedAway.total}</dd>
            ${turned.map(([k, v]) => `<dt class="sub">${REASON[k] ?? k}</dt><dd>${v}</dd>`).join('')}
          </dl>${f.quota > (f.demand - f.turnedAway.total) * 2 ? '<p class="warn">The Schedule can’t reach the Quota: expand the airport.</p>' : ''}</div>
        </section>
        <section class="col wide">
          <div class="card"><h3>Run Calendar</h3>
            ${calendar.map((w) => `<div class="week${w.locked ? ' locked' : ''}"><span class="wk">W${w.week}</span>${w.days.map((d) => {
              const cls = ['day', d.state, d.boss ? 'boss' : '', d.rush ? 'rush' : '', d.result && !d.result.quotaMet ? 'missed' : ''].join(' ');
              const tip = w.locked ? 'Locked' : `${WEEKDAY_NAMES[d.weekday]} · Quota ${d.quota} · Demand ${d.demand}${d.boss ? ' · Boss Day' : d.rush ? ' · Rush Day' : ''}${d.twist ? ` · ${d.twist.name}: ${d.twist.description}` : ''}${d.result ? ` · done ${d.result.movements}/${d.result.quota}` : ''}`;
              return `<span class="${cls}" title="${esc(tip)}"><small>${WEEKDAY_NAMES[d.weekday]}${d.twist ? ` ${ICON[d.twist.family]}` : ''}</small>${w.locked ? '🔒' : d.quota}</span>`;
            }).join('')}</div>`).join('')}
          </div>
          ${canTakeBonusTwist(run) ? `<div class="card bonus-card"><h3>Bonus Twist</h3>
            <label class="check"><input type="checkbox" data-bonus ${run.bonusTwist ? 'checked' : ''}> Add a Twist to ${dayName(run.week, run.weekday)} for +${(BONUS_TWIST_SCORE_PER_WEEK * run.week).toLocaleString('en-US')} Score if the Quota is met</label></div>` : ''}
          ${boss ? `<div class="card boss-card"><h3>Boss Day · Sunday W${run.week}</h3><p>Quota <b>${boss.quota}</b> (90% of Demand ${boss.demand} × 2).</p>
            ${boss.twists.map((t) => `<p class="boss-twist">${ICON[t.family]} <b>${esc(t.name)}</b> · ${FAMILY_NAME[t.family]} Severity ${t.severity}<br>${esc(t.description)}</p>`).join('')}</div>` : ''}
          <div class="card"><h3>Suggested</h3><ul class="tips">${tips.map((t) => `<li>${esc(t.text)}</li>`).join('') || '<li>Looking good.</li>'}</ul></div>
        </section>
        <section class="col">
          <div class="card"><h3>Upgrades</h3><div class="offers">
            ${offers.map((o) => `<button type="button" class="offer" data-buy="${o.id}" ${o.available ? '' : 'disabled'}
                title="${esc(`${o.effect}. Upkeep ${o.upkeepDelta >= 0 ? '+' : ''}${money(o.upkeepDelta)}/Day.${o.reason ? ` ${o.reason}.` : ''}`)}">
              <b>${esc(o.label)}</b><span>${o.nextLevel === null ? 'Max' : money(o.cost)}</span>
              ${o.reason && o.nextLevel !== null ? `<small>${esc(o.reason)}</small>` : ''}</button>`).join('')}
          </div><p class="msg" role="status"></p></div>
        </section>
      </div>`}`;

    el.querySelector<HTMLButtonElement>('.start')!.addEventListener('click', () => {
      build?.destroy();
      el.remove();
      handlers.onStartDay();
    });
    el.querySelector<HTMLInputElement>('input[data-bonus]')?.addEventListener('change', (e) => {
      run = handlers.onBonusTwist((e.target as HTMLInputElement).checked);
      render();
    });
    for (const b of el.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
      b.addEventListener('click', () => {
        tab = b.dataset.tab as typeof tab;
        render();
      });
    }
    if (tab === 'build') {
      void mountBuildMode(el.querySelector<HTMLElement>('.plan-build')!, run, {
        onConfirmed(next) {
          run = next;
          handlers.onBuilt(next);
          el.querySelector('.plan-head .money')!.textContent = money(next.money);
        },
      }).then((view) => {
        if (tab === 'build' && el.isConnected) build = view;
        else view.destroy();
      });
      return;
    }
    for (const b of el.querySelectorAll<HTMLButtonElement>('button[data-buy]')) {
      b.addEventListener('click', () => {
        try {
          run = handlers.onBuy(b.dataset.buy as UpgradeId);
          render(b.dataset.buy);
        } catch (e) {
          el.querySelector('.msg')!.textContent = (e as Error).message;
        }
      });
    }
    (focusId ? el.querySelector<HTMLButtonElement>(`button[data-buy="${focusId}"]`) : null)?.focus();
    if (!focusId) el.querySelector<HTMLButtonElement>('.start')!.focus();
  };
  render();
}
