import { formatClock } from '../sim/clock';
import { alerts, flightStrips, movementsPerHour, quotaProgress, runwayStatus, standsStatus } from '../sim/liveView';
import {
  ACTION_IDS, actionAvailability, mostUrgentHolding, secondRollChance, type ActionId, type Simulation,
} from '../sim/simulation';

const hhmm = (minute: number) => formatClock({ minute, pendingRealMs: 0 });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const SIZE = { small: 'S', medium: 'M', large: 'L' } as const;
const PHASE: Record<string, string> = {
  landing: 'Landing', taxiIn: 'Taxi in', inBay: 'Holding Bay', onStand: 'On Stand', taxiOut: 'Taxi out', holdShort: 'Hold short', takeoff: 'Takeoff',
};

export interface LiveDayView {
  update(sim: Simulation, quota: number): void;
  /** Shows a short message under the Emergency Actions (e.g. why an action failed). */
  message(text: string): void;
}

export interface LiveDayHandlers {
  onAction(id: ActionId, targetId: string | undefined): void;
  onAcknowledgeAlert(): void;
}

const ACTION_LABEL: Record<ActionId, [string, string]> = {
  groundStop: ['Ground Stop', 'Freezes all taxiing for 5 minutes'],
  rushTurnaround: ['Rush Turnaround', 'Halves the Turnaround at the Stand the most urgent Holding aircraft waits for'],
  manualDivert: ['Manual Divert', 'Sends the selected (or lowest-fuel) Holding aircraft away'],
  priorityLanding: ['Priority Landing', 'Moves the selected (or lowest-fuel) Holding aircraft to the front of the queue'],
};
const BUILDING: Record<string, string> = { rampAgentStation: 'Ramp Agent Station', adminOffice: 'Admin Office', airlineOffice: 'Airline Office' };

/** The Live Day screen panels around the map (ATC Console layout). The map itself is drawn by PixiJS. */
export function mountLiveDay(root: HTMLElement, handlers: LiveDayHandlers): LiveDayView {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  let selected: string | undefined;
  let lastAlertKey = '';
  let current: Simulation | undefined;

  $('.strips[data-group="holding"] ol').addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]');
    if (!li) return;
    selected = selected === li.dataset.id ? undefined : li.dataset.id;
    lastRender = -1;
    if (current) view.update(current, lastQuota);
  });
  $('#actions').addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (button && !button.disabled) handlers.onAction(button.dataset.action as ActionId, selected);
  });
  $('#alert-banner').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button[data-ack]')) handlers.onAcknowledgeAlert();
  });
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
  let lastQuota = 0;
  const view: LiveDayView = {
    message(text) {
      $('#action-msg').textContent = text;
    },
    update(sim, quota) {
      current = sim;
      lastQuota = quota;
      renderAlertBanner(sim);
      const now = sim.clock.minute;
      if (now === lastRender) return;
      lastRender = now;
      if (selected && !sim.flights.some((f) => f.id === selected && f.phase === 'holding')) selected = undefined;

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
        `<li data-id="${esc(f.id)}" tabindex="0" class="strip${f.lowFuel ? ' low' : ''}${f.id === selected ? ' selected' : ''}" title="${esc(`${f.type} · Holding since ${hhmm(f.since)} · Fuel Reserve ${Math.ceil(f.fuelMinutes)} min`)}"><b>${esc(f.id)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t fuel">⛽ ${Math.ceil(f.fuelMinutes)}′</span></li>`), strips.holding.length);
      fill('ground', strips.ground.map((f) =>
        `<li class="strip" title="${esc(`${f.type} · ${PHASE[f.phase] ?? f.phase}${f.spot ? ` · ${f.spot}` : ''}`)}"><b>${esc(f.id)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t">${PHASE[f.phase] ?? f.phase}</span></li>`), strips.ground.length);

      // Emergency Actions
      const availability = actionAvailability(sim);
      const target = selected ?? mostUrgentHolding(sim)?.id;
      $('#actions').innerHTML = ACTION_IDS.map((id) => {
        const a = availability[id];
        const [name, what] = ACTION_LABEL[id];
        const state = a.missing ? `Needs ${BUILDING[a.missing]}` : a.cooldownLeft > 0 ? `Ready in ${Math.ceil(a.cooldownLeft)} min` : 'Ready';
        const aim = (id === 'manualDivert' || id === 'priorityLanding') && target ? ` → ${target}` : '';
        return `<button type="button" class="action${a.ready ? ' ready' : ''}" data-action="${id}" ${a.ready ? '' : 'disabled'} title="${esc(what)}">
          <b>${name}${esc(aim)}</b><span>${state}</span></button>`;
      }).join('');

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
      const currentHour = Math.floor(now / 60);
      $('#hours').innerHTML = hours.map((h) =>
        `<div class="hour${h.hour === currentHour ? ' now' : ''}" title="${String(h.hour).padStart(2, '0')}:00 · ${h.done} done / ${h.forecast} expected">
          <div class="bar forecast" style="height:${(h.forecast / max) * 100}%"></div>
          <div class="bar done" style="height:${(h.done / max) * 100}%"></div>
          <span>${String(h.hour).padStart(2, '0')}</span></div>`).join('');
    },
  };

  function renderAlertBanner(sim: Simulation): void {
    const alert = sim.pendingAlert;
    const banner = $('#alert-banner');
    const key = alert ? `${alert.kind}:${alert.flightId}:${alert.minute}` : '';
    if (key === lastAlertKey) return;
    lastAlertKey = key;
    if (!alert) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    const f = sim.flights.find((x) => x.id === alert.flightId);
    banner.hidden = false;
    banner.className = `alert-banner ${alert.kind}`;
    banner.innerHTML = alert.kind === 'fuel'
      ? `<b>FUEL ALERT</b><span>${esc(alert.flightId)} (${f?.type ?? ''}) is low on fuel: ${Math.ceil(f?.fuelMinutes ?? 0)} min left. Use Emergency Actions now.</span><button type="button" data-ack>Continue</button>`
      : `<b>EMERGENCY ALERT</b><span>${esc(alert.flightId)} (${f?.type ?? ''}) is about to crash. Intervene for a second roll (${Math.round(secondRollChance(sim.controllerTrainingLevel) * 100)}% to save it).</span><button type="button" data-ack>Intervene</button>`;
    banner.querySelector<HTMLButtonElement>('button')!.focus();
  }

  return view;
}
