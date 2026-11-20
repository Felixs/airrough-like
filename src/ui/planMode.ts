import { moneyWarnings, upgradeOffers, runCalendar, suggestions, type MoneyWarning, type UpgradeId } from '../sim/plan';
import { daySections, daySummary } from './dayReport';
import { BONUS_TWIST_SCORE_PER_WEEK, canTakeBonusTwist, dayPlan, dayTwists, estimateDay, upkeep, type RunState } from '../sim/run';
import { FAMILY_NAME, type Twist } from '../sim/twists';
import { WEEKDAY_NAMES } from '../sim/schedule';
import { mountBuildMode, type BuildModeView } from './buildMode';
import { dayName } from './dayEnd';
import { seedButton, wireSeedButtons } from './seed';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const ICON: Record<Twist['family'], string> = { weather: '☁', infrastructure: '⚠', surge: '▲' };
const WARN_ICON: Record<MoneyWarning['kind'], string> = { quota: '⛔', stands: '🅿', runway: '🛬', dark: '🌙' };
const UPGRADE_GROUPS: ReadonlyArray<{ title: string; ids: readonly UpgradeId[] }> = [
  { title: 'Runways', ids: ['surface'] },
  { title: 'ATC Tower', ids: ['radar', 'groundRadar', 'weatherStation', 'controllerTraining'] },
  { title: 'Safety', ids: ['fireRescue'] },
];
const UPGRADE_ICON: Record<UpgradeId, string> = { surface: '💡', radar: '📡', groundRadar: '🛰', weatherStation: '🌦', controllerTraining: '🎧', fireRescue: '🚒' };

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
  wireSeedButtons(el, () => run);
  let tab: 'overview' | 'build' | 'lastDay' = 'overview';
  /** The Run Calendar Day shown in detail (the next Day until another is clicked). */
  let pick = { week: run.week, weekday: run.weekday };
  let build: BuildModeView | null = null;

  /**
   * Leaving Build Mode (another tab, or Start Day) with changes placed but not confirmed: ask whether to build or
   * discard them, so they are never lost without the Player noticing.
   */
  const leaveBuild = (then: () => void) => {
    const open = tab === 'build' ? build?.pending() : undefined;
    if (!build || !open || open.count === 0) return then();
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Unconfirmed building');
    dialog.innerHTML = `<div class="box">
      <h3>Build your changes?</h3>
      <p>${open.count} change${open.count === 1 ? '' : 's'} in Build Mode ${open.count === 1 ? 'is' : 'are'} not confirmed yet (${open.cost < 0 ? `refund ${money(-open.cost)}` : money(open.cost)}). Unconfirmed changes are not built.</p>
      <div class="buttons">
        <button type="button" data-choice="build" class="primary">Build them</button>
        <button type="button" data-choice="discard">Discard</button>
        <button type="button" data-choice="stay">Keep building</button>
      </div></div>`;
    el.appendChild(dialog);
    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      dialog.remove();
    };
    const choose = (choice: string | undefined) => {
      close();
      if (choice === 'build') {
        if (build?.confirm()) then(); // on failure the reason shows in the Build panel and the Player stays
      } else if (choice === 'discard') then();
    };
    // Esc keeps building; Enter is the focused button (and never reaches Build Mode's own shortcuts)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.stopPropagation();
        e.preventDefault();
        choose(e.key === 'Escape' ? 'stay' : (document.activeElement as HTMLElement | null)?.dataset.choice);
      }
    };
    window.addEventListener('keydown', onKey, true);
    for (const b of dialog.querySelectorAll<HTMLButtonElement>('button[data-choice]')) b.addEventListener('click', () => choose(b.dataset.choice));
    dialog.querySelector<HTMLButtonElement>('button[data-choice="build"]')!.focus();
  };

  const render = (focusId?: string) => {
    build?.destroy();
    build = null;
    const plan = dayPlan(run);
    const f = plan.forecast;
    const est = estimateDay(run);
    const last = run.history[run.history.length - 1];
    const calendar = runCalendar(run);
    const offers = upgradeOffers(run);
    const tips = suggestions(run);
    const warnings = moneyWarnings(run);
    const lostTotal = warnings.reduce((n, w) => n + w.lost, 0);
    const twists = dayTwists(run);
    if (!calendar.some((w) => !w.locked && w.week === pick.week)) pick = { week: run.week, weekday: run.weekday };
    const picked = calendar.find((w) => w.week === pick.week)?.days[pick.weekday];

    el.innerHTML = `
      <header class="plan-head">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" data-tab="overview" aria-selected="${tab === 'overview'}">Overview</button>
          <button type="button" role="tab" data-tab="build" aria-selected="${tab === 'build'}">Build</button>
          ${last ? `<button type="button" role="tab" data-tab="lastDay" aria-selected="${tab === 'lastDay'}">Last Day</button>` : ''}
        </div>
        <span class="next">${run.endless ? '<b class="endless">Endless</b> · ' : ''}Next: <b>${dayName(run.week, run.weekday)}</b>${plan.weekday === 6 ? ' · Boss Day' : plan.weekday === 5 ? ' · Rush Day' : ''}</span>
        ${seedButton(run)}
        <span class="spacer"></span>
        <span class="money${run.inDebt ? ' debt' : ''}" title="Upkeep ${money(upkeep(run))} per Day, paid at 24:00">${money(run.money)}</span>
        <button type="button" class="start">Start Day ▶</button>
      </header>
      ${tab === 'build' ? '<div class="plan-build"></div>' : tab === 'lastDay' ? `<div class="plan-body last-day"><div class="card report report-inline">${last ? `${daySummary(run)}${daySections(run)}` : '<p>No Day played yet.</p>'}</div></div>` : `<div class="plan-body dash">
        <section class="warnings${warnings.length ? '' : ' clear'}" aria-label="Money at risk tomorrow">${warnings.length
          ? `<h3>Money at risk · ${dayName(run.week, run.weekday)}${lostTotal ? ` <span class="lost">≈ −${money(lostTotal)} in fees</span>` : ''}</h3>
            <ul>${warnings.map((w) => `<li class="warning ${w.severity}"><span class="w-icon" aria-hidden="true">${WARN_ICON[w.kind]}</span>
              <div><b>${esc(w.title)}</b>${w.lost ? ` <span class="lost">≈ −${money(w.lost)}</span>` : ''}<br><span class="w-detail">${esc(w.detail)}</span> <span class="w-fix">→ ${esc(w.fix)}</span></div>
              ${w.upgrade ? `<button type="button" class="w-act" data-buy="${w.upgrade}">Buy</button>` : '<button type="button" class="w-act" data-tab="build">Build</button>'}</li>`).join('')}</ul>`
          : `<h3>✓ Nothing costs money tomorrow</h3><p>Every flight that wants to come can come, and nothing lands in the dark without lights.</p>`}</section>
        <section class="col">
          <div class="card forecast"><h3>Forecast · ${dayName(run.week, run.weekday)}</h3>
            ${twists.map((t) => `<p class="twist" title="${esc(t.description)}">${ICON[t.family]} <b>${esc(t.name)}</b> · ${esc(t.description)}</p>`).join('')}
            <h4>Quota</h4><dl>
              <dt>Daily Quota</dt><dd><b>${f.quota}</b> Movements</dd>
              <dt title="Two per arrival, one per aircraft parked overnight">Possible at most</dt><dd class="${f.maxMovements < f.quota ? 'neg' : ''}">${f.maxMovements}</dd>
            </dl>
            <h4>Traffic</h4><dl>
              <dt>Demand</dt><dd>${f.demand} flights</dd>
              <dt>Coming</dt><dd>${f.demand - f.turnedAway.total} flights${f.turnedAway.total ? ` <span class="neg">(${f.turnedAway.total} turned away)</span>` : ''}</dd>
              <dt>Peak hour</dt><dd>${String(f.peakHour).padStart(2, '0')}:00</dd>
            </dl>
            <table class="mix"><thead><tr><th></th><th>S</th><th>M</th><th>L</th></tr></thead><tbody>
              <tr><th title="Need Terminal Stands">Passenger</th><td>${f.arrivalsByPurpose.passenger.small}</td><td>${f.arrivalsByPurpose.passenger.medium}</td><td>${f.arrivalsByPurpose.passenger.large}</td></tr>
              <tr><th title="Need Cargo Hub Stands">Cargo</th><td>${f.arrivalsByPurpose.cargo.small}</td><td>${f.arrivalsByPurpose.cargo.medium}</td><td>${f.arrivalsByPurpose.cargo.large}</td></tr>
            </tbody></table>
            <h4>Money</h4><dl>
              <dt title="If every flight that comes is handled">Expected fees</dt><dd class="expect" title="${esc(`Arrival Fees ${money(est.arrivalFees)} · Departure Fees ${money(est.departureFees)} (aircraft that can't leave before dark pay theirs tomorrow)`)}">≈ ${money(est.fees)}</dd>
              <dt>Upkeep at 24:00</dt><dd>${money(-est.upkeep)}</dd>
              <dt>Expected net</dt><dd class="expect ${est.net < 0 ? 'neg' : 'pos'}">≈ ${est.net >= 0 ? '+' : ''}${money(est.net)}</dd>
              <dt>Money after the Day</dt><dd class="expect">≈ ${money(est.moneyAfter)}</dd>
            </dl></div>
        </section>
        <section class="col wide">
          <div class="card calendar"><h3>Run Calendar <small>click a Day for details</small></h3>
            <div class="week head"><span></span>${WEEKDAY_NAMES.map((n) => `<span>${n}</span>`).join('')}</div>
            ${calendar.map((w) => `<div class="week${w.locked ? ' locked' : ''}"><span class="wk">W${w.week}</span>${w.days.map((d) => {
              const isPicked = pick.week === w.week && pick.weekday === d.weekday;
              const cls = ['day', d.state, d.boss ? 'boss' : '', d.rush ? 'rush' : '', d.result && !d.result.quotaMet ? 'missed' : '', isPicked ? 'picked' : ''].join(' ');
              const marks = `${d.boss ? '♛' : d.rush ? '⇈' : ''}${d.twists.map((t) => ICON[t.family]).join('')}`;
              const mark = d.result ? (d.result.quotaMet ? '✓' : '✗') : '';
              if (w.locked) return `<span class="${cls}" aria-disabled="true"><span class="icons">${d.boss ? '♛' : ''}</span>🔒</span>`;
              return `<button type="button" class="${cls}" data-week="${w.week}" data-weekday="${d.weekday}" aria-pressed="${isPicked}"
                aria-label="${esc(`${WEEKDAY_NAMES[d.weekday]} Week ${w.week}: Quota ${d.quota}, Demand ${d.demand}${d.boss ? ', Boss Day' : d.rush ? ', Rush Day' : ''}${mark ? `, ${d.result!.quotaMet ? 'met' : 'missed'}` : ''}`)}">
                <span class="icons">${marks || '&nbsp;'}</span><b class="q">${d.quota}</b><small>D ${d.demand}</small>${mark ? `<i class="mark">${mark}</i>` : ''}</button>`;
            }).join('')}</div>`).join('')}
            <p class="legend">♛ Boss Day · ⇈ Rush Day · ☁ Weather · ⚠ Infrastructure · ▲ Traffic surge · big number = Quota, D = Demand</p>
          </div>
          ${picked ? `<div class="card day-detail${picked.boss ? ' boss' : ''}"><h3>${dayName(pick.week, pick.weekday)}${picked.boss ? ' · Boss Day' : picked.rush ? ' · Rush Day' : ''}${picked.state === 'today' ? ' · next' : ''}</h3>
            <div class="kpis">
              <div class="kpi"><span class="kpi-label">Quota</span><b class="kpi-value">${picked.quota}</b><span class="kpi-note">Movements (${picked.boss ? '90' : '75'}% of Demand × 2)</span></div>
              <div class="kpi"><span class="kpi-label">Demand</span><b class="kpi-value">${picked.demand}</b><span class="kpi-note">flights want to come</span></div>
              <div class="kpi"><span class="kpi-label">${picked.result ? 'Result' : 'Twists'}</span><b class="kpi-value ${picked.result ? (picked.result.quotaMet ? 'ok' : 'bad') : ''}">${picked.result ? `${picked.result.movements}/${picked.result.quota}` : picked.twists.length || '–'}</b><span class="kpi-note">${picked.result ? (picked.result.quotaMet ? '✓ Quota met' : '✗ Quota missed') : picked.twists.length ? 'see below' : 'a normal Day'}</span></div>
            </div>
            ${picked.twists.map((t) => `<p class="boss-twist">${ICON[t.family]} <b>${esc(t.name)}</b> · ${FAMILY_NAME[t.family]} Severity ${t.severity}<br>${esc(t.description)}</p>`).join('')}
            ${picked.rush ? '<p class="note">Rush Day: about twice the traffic of a weekday.</p>' : ''}${picked.boss ? '<p class="note">Boss Day: peak traffic and a Boss Twist; the Quota is 90% of Demand.</p>' : ''}</div>` : ''}
          ${canTakeBonusTwist(run) ? `<div class="card bonus-card"><h3>Bonus Twist</h3>
            <label class="check"><input type="checkbox" data-bonus ${run.bonusTwist ? 'checked' : ''}> Add a Twist to ${dayName(run.week, run.weekday)} for +${(BONUS_TWIST_SCORE_PER_WEEK * run.week).toLocaleString('en-US')} Score if the Quota is met</label></div>` : ''}
        </section>
        <section class="col">
          <div class="card"><h3>Upgrades</h3>
            ${UPGRADE_GROUPS.map((g) => `<h4>${g.title}</h4><div class="offers">${offers.filter((o) => g.ids.includes(o.id)).map((o) => `<button type="button" class="offer" data-buy="${o.id}" ${o.available ? '' : 'disabled'}
                title="${esc(`${o.effect}. Upkeep ${o.upkeepDelta >= 0 ? '+' : ''}${money(o.upkeepDelta)}/Day.${o.reason ? ` ${o.reason}.` : ''}`)}">
              <span class="o-icon" aria-hidden="true">${UPGRADE_ICON[o.id]}</span><b>${esc(o.label)}</b><span class="cost">${o.nextLevel === null ? 'Max' : money(o.cost)}</span>
              <small class="effect">${esc(o.effect)}</small>
              ${o.reason && o.nextLevel !== null ? `<small>${esc(o.reason)}</small>` : ''}</button>`).join('')}</div>`).join('')}
            <p class="msg" role="status"></p></div>
          ${tips.length ? `<div class="card"><h3>Suggested</h3><ul class="tips">${tips.map((t) => `<li>${esc(t.text)}</li>`).join('')}</ul></div>` : ''}
        </section>
      </div>`}`;

    el.querySelector<HTMLButtonElement>('.start')!.addEventListener('click', () => leaveBuild(() => {
      build?.destroy();
      el.remove();
      handlers.onStartDay();
    }));
    el.querySelector<HTMLInputElement>('input[data-bonus]')?.addEventListener('change', (e) => {
      run = handlers.onBonusTwist((e.target as HTMLInputElement).checked);
      render();
    });
    for (const b of el.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
      b.addEventListener('click', () => {
        if (b.dataset.tab === tab) return;
        leaveBuild(() => {
          tab = b.dataset.tab as typeof tab;
          render();
        });
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
    for (const b of el.querySelectorAll<HTMLButtonElement>('button[data-week]')) {
      b.addEventListener('click', () => {
        pick = { week: Number(b.dataset.week), weekday: Number(b.dataset.weekday) };
        render();
        el.querySelector<HTMLButtonElement>(`button[data-week="${pick.week}"][data-weekday="${pick.weekday}"]`)?.focus();
      });
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
