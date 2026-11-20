import { MILESTONES, milestoneProgress, newMilestones, type MetaState } from '../sim/meta';
import { dayTwists, type RunState } from '../sim/run';
import { formatClock } from '../sim/clock';
import { dayName } from './dayEnd';

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
} as const;

/** The end-of-Day overview: money, traffic, safety, Milestones and what comes next. */
export function showDayReport(root: HTMLElement, run: RunState, meta: MetaState, onContinue: () => void): void {
  const r = run.history[run.history.length - 1];
  if (!r) {
    onContinue();
    return;
  }
  const reached = newMilestones(meta, run);
  const progress = milestoneProgress(meta, run);
  const diversions = Object.entries(r.diversionsByReason).filter(([, n]) => n > 0) as Array<[keyof typeof REASON, number]>;
  const twists = dayTwists(run);
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Day report');
  el.innerHTML = `
    <div class="card report">
      <h2>${dayName(r.week, r.weekday)} <span class="${r.quotaMet ? 'ok' : 'bad'}">${r.quotaMet ? '✓ Quota met' : '✗ Quota missed'}</span></h2>
      <p class="lead">${r.movements} of ${r.quota} Movements${r.movements > r.quota ? ` (+${r.movements - r.quota} spare)` : ''} · busiest hour ${String(r.busiestHour).padStart(2, '0')}:00</p>
      <div class="report-cols">
        <section><h3>Money</h3><dl>
          <dt>Fees</dt><dd class="ok">${signed(r.fees)}</dd>
          <dt>Upkeep</dt><dd>${signed(-r.upkeep)}</dd>
          <dt>Fines &amp; Incidents</dt><dd class="${r.penalties ? 'bad' : ''}">${signed(-r.penalties)}</dd>
          <dt><b>Net</b></dt><dd><b class="${r.net >= 0 ? 'ok' : 'bad'}">${signed(r.net)}</b></dd>
          <dt>Money now</dt><dd class="${run.inDebt ? 'bad' : ''}">${money(r.moneyAfter)}${run.inDebt ? ' · Debt: building blocked' : ''}</dd>
        </dl></section>
        <section><h3>Traffic</h3><dl>
          <dt>Landed</dt><dd>${r.landed.passenger} passenger · ${r.landed.cargo} cargo</dd>
          <dt>Diverted</dt><dd>${r.diversions}</dd>
          ${diversions.map(([k, n]) => `<dt class="sub">${n} ${REASON[k]}</dt><dd></dd>`).join('')}
          <dt>Parked overnight</dt><dd>${run.overnight.length}</dd>
        </dl></section>
      </div>
      <section><h3>Safety</h3>${r.highlights.length
        ? `<ul class="events">${r.highlights.map((h) => `<li class="${h.kind === 'crash' ? 'bad' : 'warn'}"><span class="t">${hhmm(h.minute)}</span> ${KIND[h.kind]}: ${esc(h.callsign)} (${esc(h.aircraft)})${h.cost ? ` · ${signed(-h.cost)}` : ''}</li>`).join('')}</ul>`
        : '<p class="ok">No Crashes or Incidents today.</p>'}</section>
      <section><h3>Progress</h3>
        ${reached.map((id) => {
          const m = MILESTONES.find((x) => x.id === id)!;
          return `<p class="milestone">★ Milestone reached: <b>${esc(m.name)}</b>, unlocks ${esc(m.unlocks)} from your next Run</p>`;
        }).join('')}
        <ul class="progress">${progress.map((p) => `<li>${esc(p.text)}</li>`).join('')}</ul>
      </section>
      <p class="lead">Next: <b>${dayName(run.week, run.weekday)}</b>${run.weekday === 6 ? ' · Boss Day' : run.weekday === 5 ? ' · Rush Day' : ''}${twists.map((t) => ` · ${esc(t.name)}`).join('')}</p>
      <button type="button" class="primary">Plan the next Day</button>
    </div>`;
  el.querySelector('button')!.addEventListener('click', () => {
    el.remove();
    onContinue();
  });
  root.appendChild(el);
  el.querySelector<HTMLButtonElement>('button')!.focus();
}
