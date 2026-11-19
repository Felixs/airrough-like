import { formatClock } from '../sim/clock';
import { alerts, flightStrips, movementsPerHour, quotaProgress, runwayStatus, standsStatus } from '../sim/liveView';
import type { Simulation } from '../sim/simulation';

const hhmm = (minute: number) => formatClock({ minute, pendingRealMs: 0 });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const SIZE = { small: 'S', medium: 'M', large: 'L' } as const;
const PHASE: Record<string, string> = {
  landing: 'Landing', taxiIn: 'Taxi in', inBay: 'Holding Bay', onStand: 'On Stand', taxiOut: 'Taxi out', holdShort: 'Hold short', takeoff: 'Takeoff',
};

export interface LiveDayView {
  update(sim: Simulation, quota: number): void;
}

/** The Live Day screen panels around the map (ATC Console layout). The map itself is drawn by PixiJS. */
export function mountLiveDay(root: HTMLElement): LiveDayView {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const rail = $('#rail');
  const toggle = $<HTMLButtonElement>('#rail-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = rail.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '⟩' : '⟨';
    toggle.title = collapsed ? 'Expand flight strips' : 'Collapse flight strips';
  });

  let lastRender = -1;
  let lastEvents = -1;
  return {
    update(sim, quota) {
      const now = sim.clock.minute;
      if (now === lastRender) return;
      lastRender = now;

      // Quota bar
      const q = quotaProgress(sim, quota);
      const meter = $('#quota');
      meter.setAttribute('aria-valuemax', String(q.quota));
      meter.setAttribute('aria-valuenow', String(q.movements));
      meter.classList.toggle('met', q.met);
      meter.classList.toggle('behind', !q.met && q.movements < q.pace);
      meter.title = q.met
        ? 'Daily Quota met'
        : `${q.stillNeeded} more Movements needed by 24:00. The marker shows a steady pace (${q.pace} by now).`;
      $('.quota-fill').style.width = `${Math.min(100, (q.movements / Math.max(1, q.quota)) * 100)}%`;
      $('.quota-pace').style.left = `${Math.min(100, (q.pace / Math.max(1, q.quota)) * 100)}%`;
      $('#movements').textContent = String(q.movements);
      $('#quota-value').textContent = String(q.quota);
      $('#money').textContent = Math.round(sim.money).toLocaleString('en-US');
      $('#money').classList.toggle('debt', sim.money < 0);

      // Flight strips
      const strips = flightStrips(sim);
      const fill = (group: string, items: string[], count: number) => {
        const section = $(`.strips[data-group="${group}"]`);
        section.querySelector('.count')!.textContent = String(count);
        section.querySelector('ol')!.innerHTML = items.join('');
      };
      fill('inbound', strips.inbound.slice(0, 8).map((f) =>
        `<li class="strip" title="${esc(`${f.type} · ${f.purpose} · arrives ${hhmm(f.eta)}`)}"><b>${esc(f.id)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t">${hhmm(f.eta)}</span></li>`), strips.inbound.length);
      fill('holding', strips.holding.map((f) =>
        `<li class="strip${f.lowFuel ? ' low' : ''}" title="${esc(`${f.type} · Holding since ${hhmm(f.since)} · Fuel Reserve ${Math.ceil(f.fuelMinutes)} min`)}"><b>${esc(f.id)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t fuel">⛽ ${Math.ceil(f.fuelMinutes)}′</span></li>`), strips.holding.length);
      fill('ground', strips.ground.map((f) =>
        `<li class="strip" title="${esc(`${f.type} · ${PHASE[f.phase] ?? f.phase}${f.spot ? ` · ${f.spot}` : ''}`)}"><b>${esc(f.id)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t">${PHASE[f.phase] ?? f.phase}</span></li>`), strips.ground.length);

      // Alerts (only when something new happened)
      if (sim.events.length !== lastEvents) {
        lastEvents = sim.events.length;
        $('#alerts').innerHTML = alerts(sim).slice(0, 12).map((a) =>
          `<li class="alert ${a.severity}"><span class="t">${hhmm(a.minute)}</span> ${esc(a.text)}</li>`).join('') || '<li class="empty">All quiet</li>';
      }

      // Stands
      $('#stands').innerHTML = standsStatus(sim).map((s) => {
        const what = s.kind === 'holdingBay' ? `Holding Bay ${s.id}` : `Stand ${s.id} (${s.serves === 'terminal' ? 'Terminal' : 'Cargo Hub'})`;
        const tip = `${what} · ${s.size} · ${s.state}${s.aircraft ? ` · ${s.flightId} ${s.aircraft}` : ''}`;
        return `<span class="spot ${s.state}${s.kind === 'holdingBay' ? ' bay' : ''}" title="${esc(tip)}">${esc(s.id)}<small>${SIZE[s.size]}</small></span>`;
      }).join('');

      // Runway and wind chips
      const rw = runwayStatus(sim);
      const state = { open: 'OPEN', blocked: `BLOCKED until ${rw.until !== null ? hhmm(rw.until) : ''}`, dark: 'CLOSED (dark)', curfew: 'CURFEW' }[rw.state];
      const chip = $('#runway-chip');
      chip.textContent = `RWY ${rw.name} ${state}`;
      chip.className = `chip ${rw.state}`;
      chip.title = rw.state === 'dark' ? 'Only Lit or ILS Runways work after 20:00' : rw.state === 'blocked' ? 'Cleared faster with a Fire & Rescue Station' : '';
      $('#wind-chip').textContent = `Wind ${String(rw.wind.direction).padStart(3, '0')}° ${rw.wind.knots} kt`;

      // Movements per hour
      const hours = movementsPerHour(sim, sim.flights);
      const max = Math.max(4, ...hours.map((h) => Math.max(h.done, h.forecast)));
      const current = Math.floor(now / 60);
      $('#hours').innerHTML = hours.map((h) =>
        `<div class="hour${h.hour === current ? ' now' : ''}" title="${String(h.hour).padStart(2, '0')}:00 · ${h.done} done / ${h.forecast} expected">
          <div class="bar forecast" style="height:${(h.forecast / max) * 100}%"></div>
          <div class="bar done" style="height:${(h.done / max) * 100}%"></div>
          <span>${String(h.hour).padStart(2, '0')}</span></div>`).join('');
    },
  };
}
