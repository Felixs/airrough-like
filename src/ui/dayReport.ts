import { dayTwists, type RunState } from '../sim/run';
import { formatClock } from '../sim/clock';
import { dayName } from './dayEnd';
import { seedButton, wireSeedButtons } from './seed';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const hhmm = (minute: number) => formatClock({ minute, pendingRealMs: 0 });
const KIND = { crash: 'Crash', incident: 'Runway Incident', taxiIncident: 'Taxiway Incident' } as const;
const REASON = {
  dark: 'at dusk: no Lit Runway',
  noRunway: 'low on fuel with no usable Runway',
  curfew: 'after 22:00 / at the Curfew',
  manual: 'by Manual Divert',
  lowFuel: 'at low fuel, by your choice',
} as const;

/** The Day's sections (money, traffic, safety) for the Day report and the Score Screen. */
export function daySections(run: RunState): string {
  const r = run.history[run.history.length - 1];
  if (!r) return '';
  const diversions = Object.entries(r.diversionsByReason).filter(([, n]) => n > 0) as Array<[keyof typeof REASON, number]>;
  return `
      <h3 class="day-title">${dayName(r.week, r.weekday)} <span class="${r.quotaMet ? 'ok' : 'bad'}">${r.quotaMet ? '✓ Quota met' : '✗ Quota missed'}</span></h3>
      <p class="lead">${r.movements} of ${r.quota} Movements${r.movements > r.quota ? ` (+${r.movements - r.quota} spare)` : ''} · busiest hour ${String(r.busiestHour).padStart(2, '0')}:00</p>
      <div class="report-cols">
        <section><h3>Money</h3><dl>
          <dt>Fees</dt><dd class="ok">${signed(r.fees)}</dd>
          ${r.contractFees ? `<dt class="sub">of which Airline Contracts</dt><dd>${signed(r.contractFees)}</dd>` : ''}
          <dt>Upkeep</dt><dd>${signed(-r.upkeep)}</dd>
          <dt><b>Net</b></dt><dd><b class="${r.net >= 0 ? 'ok' : 'bad'}">${signed(r.net)}</b></dd>
          <dt>Money now</dt><dd class="${run.inDebt ? 'bad' : ''}">${money(r.moneyAfter)}${run.inDebt ? ' · Debt: building blocked' : ''}</dd>
        </dl></section>
        <section><h3>Traffic</h3><dl>
          <dt>Landed</dt><dd>${r.landed.passenger} passenger · ${r.landed.cargo} cargo</dd>
          <dt>Diverted</dt><dd>${r.diversions}</dd>
          ${diversions.map(([k, n]) => `<dt class="sub">${n} ${REASON[k]}</dt>`).join('')}
          <dt>Parked overnight</dt><dd>${run.overnight.length}</dd>
        </dl></section>
      </div>
      <section><h3>Safety</h3>${r.highlights.length
        ? `<ul class="events">${r.highlights.map((h) => `<li class="${h.kind === 'crash' ? 'bad' : 'warn'}"><span class="t">${hhmm(h.minute)}</span> ${KIND[h.kind]}: ${esc(h.callsign)} (${esc(h.aircraft)})${h.story ? `, ${esc(h.story)}` : ''}${h.cost ? ` · ${signed(-h.cost)}` : ''}</li>`).join('')}</ul>`
        : '<p class="ok">No Crashes or Incidents today.</p>'}</section>`;
}

/** Wires a report's Summary / Details tabs. */
export function wireReportTabs(el: HTMLElement): void {
  el.querySelector('.report-tabs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-panel]');
    if (!b) return;
    for (const t of el.querySelectorAll<HTMLButtonElement>('.report-tabs button')) t.setAttribute('aria-selected', String(t === b));
    for (const p of el.querySelectorAll<HTMLElement>('[role="tabpanel"]')) p.hidden = p.dataset.panel !== b.dataset.panel;
  });
}

/** Summary and Details tabs around two panels. */
export function reportTabs(summary: string, details: string): string {
  return `<nav class="tabs report-tabs" role="tablist">
      <button type="button" role="tab" data-panel="summary" aria-selected="true">Summary</button>
      <button type="button" role="tab" data-panel="details" aria-selected="false">Details</button></nav>
    <div role="tabpanel" data-panel="summary" class="report-panel">${summary}</div>
    <div role="tabpanel" data-panel="details" class="report-panel" hidden>${details}</div>`;
}

/** A big number with a caption, for the Summary tabs. */
export const kpi = (label: string, value: string, note = '', cls = '') =>
  `<div class="kpi"><span class="kpi-label">${label}</span><b class="kpi-value ${cls}">${value}</b>${note ? `<span class="kpi-note">${note}</span>` : ''}</div>`;

/** The Day at a glance: Quota, money, traffic and trouble. */
export function daySummary(run: RunState): string {
  const r = run.history[run.history.length - 1];
  if (!r) return '';
  const trouble = r.crashes + r.highlights.filter((h) => h.kind !== 'crash').length;
  const share = Math.min(100, Math.round((r.movements / Math.max(1, r.quota)) * 100));
  return `
      <h3 class="day-title">${dayName(r.week, r.weekday)}</h3>
      <div class="quota-meter ${r.quotaMet ? 'ok' : 'bad'}">
        <span class="quota-big">${r.quotaMet ? '✓ Quota met' : '✗ Quota missed'}</span>
        <span class="quota-count">${r.movements} / ${r.quota} Movements</span>
        <span class="bar"><span style="width:${share}%"></span></span>
      </div>
      <div class="kpis">
        ${kpi('Net today', signed(r.net), `Money now ${money(r.moneyAfter)}`, r.net >= 0 ? 'ok' : 'bad')}
        ${kpi('Landed', String(r.landed.passenger + r.landed.cargo), `${r.diversions} diverted`)}
        ${kpi('Safety', trouble ? `${trouble}` : '✓', trouble ? `${r.crashes} Crash${r.crashes === 1 ? '' : 'es'} · ${trouble - r.crashes} Incident${trouble - r.crashes === 1 ? '' : 's'}` : 'No Crashes or Incidents', trouble ? (r.crashes ? 'bad' : 'warn') : 'ok')}
      </div>${run.inDebt ? '<p class="bad">In debt: building is blocked until the money is back above zero.</p>' : ''}`;
}

/** The end-of-Day overview: money, traffic, safety and what comes next. */
export function showDayReport(root: HTMLElement, run: RunState, onContinue: () => void): void {
  if (!run.history.length) {
    onContinue();
    return;
  }
  const twists = dayTwists(run);
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Day report');
  el.innerHTML = `
    <div class="card report">
      ${reportTabs(daySummary(run), `${daySections(run)}
        <p class="seed-line">${seedButton(run)} <small>Found a bug? Copy this and send it along.</small></p>`)}
      <div class="report-foot">
        <p class="lead">Next: <b>${dayName(run.week, run.weekday)}</b>${run.weekday === 6 ? ' · Boss Day' : run.weekday === 5 ? ' · Rush Day' : ''}${twists.map((t) => ` · ${esc(t.name)}`).join('')}</p>
        <button type="button" class="primary">Plan the next Day</button>
      </div>
    </div>`;
  wireSeedButtons(el, () => run);
  wireReportTabs(el);
  el.querySelector('button.primary')!.addEventListener('click', () => {
    el.remove();
    onContinue();
  });
  root.appendChild(el);
  el.querySelector<HTMLButtonElement>('button.primary')!.focus();
}
