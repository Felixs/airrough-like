import { formatClock } from '../sim/clock';
import { ROLE_NAME } from '../sim/build';
import { alerts, callsignOf, describeEvent, flightStrips, movementsPerHour, quotaProgress, runwayStatuses, standsStatus } from '../sim/liveView';
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
  /** The aircraft picked from a flight strip or an alert, to ring on the map (none: undefined). */
  highlighted(): string | undefined;
}

export interface LiveDayHandlers {
  onAction(id: ActionId, targetId: string | undefined): void;
  onAcknowledgeAlert(): void;
  /** The low-fuel decision. */
  onFuelChoice(choice: 'divert' | 'mayday'): void;
}

const ACTION_LABEL: Record<ActionId, [string, string]> = {
  rushTurnaround: ['Rush Turnaround', 'Halves the Turnaround at the Stand the most urgent Holding aircraft waits for'],
  manualDivert: ['Manual Divert', 'Sends the selected (or lowest-fuel) Holding aircraft away'],
  priorityLanding: ['Priority Landing', 'Moves the selected (or lowest-fuel) Holding aircraft to the front of the queue'],
};
const BUILDING: Record<string, string> = ROLE_NAME;

/** The Live Day screen panels around the map (ATC Console layout). The map itself is drawn in 3D by Babylon.js (src/render/view.ts). */
export function mountLiveDay(root: HTMLElement, handlers: LiveDayHandlers): LiveDayView {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  let selected: string | undefined;
  let highlight: string | undefined;
  const rail = $('#rail');
  let lastAlertKey = '';
  let current: Simulation | undefined;

  /** Picks an aircraft (or drops it when picked again): its strip lights up and it is ringed on the map. */
  const pick = (id: string, holding: boolean) => {
    highlight = highlight === id ? undefined : id;
    if (holding) selected = highlight; // a Holding aircraft is also the target of Manual Divert / Priority Landing
    rail.classList.remove('collapsed');
    lastRender = -1;
    if (current) view.update(current, lastQuota);
    root.querySelector(`.strip[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onPick = (e: Event) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]');
    if (li) pick(li.dataset.id!, !!li.closest('.strips[data-group="holding"]'));
  };
  const onKeyPick = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).matches('li[data-id]')) {
      e.preventDefault();
      e.stopPropagation();
      onPick(e);
    }
  };
  $('#rail').addEventListener('click', onPick);
  $('#rail').addEventListener('keydown', onKeyPick);
  $('#alerts').addEventListener('click', onPick);
  $('#alerts').addEventListener('keydown', onKeyPick);
  $('#actions').addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (button && !button.disabled) handlers.onAction(button.dataset.action as ActionId, selected);
  });
  $('#alert-banner').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button[data-fuel="divert"]')) {
      handlers.onFuelChoice('divert');
    } else if (target.closest('button[data-ack]')) {
      handlers.onAcknowledgeAlert();
    }
  });
  const toggle = $<HTMLButtonElement>('#rail-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = rail.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '⟩' : '⟨';
    toggle.title = collapsed ? 'Expand flight strips' : 'Collapse flight strips';
  });

  let lastRender = -1;
  let lastEvents = -1;
  let lastHighlight: string | undefined;
  let lastQuota = 0;
  const view: LiveDayView = {
    highlighted: () => highlight,
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
      if (highlight && !sim.flights.some((f) => f.id === highlight && !['departed', 'diverted', 'crashed'].includes(f.phase))) highlight = undefined;
      const lit = (id: string) => (id === highlight ? ' highlight' : '');
      const pickable = (id: string) => `data-id="${esc(id)}" tabindex="0" aria-pressed="${id === highlight}"`;

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
      const inbound = strips.inbound.slice(0, 8);
      const picked = strips.inbound.find((f) => f.id === highlight);
      if (picked && !inbound.includes(picked)) inbound.push(picked);
      fill('inbound', inbound.map((f) =>
        `<li ${pickable(f.id)} class="strip${lit(f.id)}" title="${esc(`${f.spoken} · ${f.type} · ${f.purpose} · arrives ${hhmm(f.eta)}`)}"><b>${esc(f.callsign)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t">${hhmm(f.eta)}</span></li>`), strips.inbound.length);
      fill('holding', strips.holding.map((f) =>
        `<li ${pickable(f.id)} class="strip${f.lowFuel ? ' low' : ''}${f.id === selected ? ' selected' : ''}${lit(f.id)}" title="${esc(`${f.spoken} · ${f.type} · Holding since ${hhmm(f.since)} · Fuel Reserve ${Math.ceil(f.fuelMinutes)} min`)}"><b>${esc(f.callsign)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t fuel">⛽ ${Math.ceil(f.fuelMinutes)}′</span></li>`), strips.holding.length);
      fill('ground', strips.ground.map((f) =>
        `<li ${pickable(f.id)} class="strip${lit(f.id)}" title="${esc(`${f.spoken} · ${f.type} · ${(f.waiting ? 'Waiting' : PHASE[f.phase] ?? f.phase)}${f.spot ? ` · ${f.spot}` : ''}`)}"><b>${esc(f.callsign)}</b><span>${f.type}</span><span class="size">${SIZE[f.size]}</span><span class="t">${(f.waiting ? 'Waiting' : PHASE[f.phase] ?? f.phase)}</span></li>`), strips.ground.length);

      // Emergency Actions
      const availability = actionAvailability(sim);
      const target = selected ?? mostUrgentHolding(sim)?.id;
      $('#actions').innerHTML = ACTION_IDS.map((id) => {
        const a = availability[id];
        const [name, what] = ACTION_LABEL[id];
        const state = a.missing ? `Needs ${BUILDING[a.missing]}` : a.cooldownLeft > 0 ? `Ready in ${Math.ceil(a.cooldownLeft)} min` : 'Ready';
        const aim = (id === 'manualDivert' || id === 'priorityLanding') && target ? ` → ${callsignOf(sim, target)}` : '';
        return `<button type="button" class="action${a.ready ? ' ready' : ''}" data-action="${id}" ${a.ready ? '' : 'disabled'} title="${esc(what)}">
          <b>${name}${esc(aim)}</b><span>${state}</span></button>`;
      }).join('');

      // Alerts (only when something new happened)
      if (sim.events.length !== lastEvents || highlight !== lastHighlight) {
        lastEvents = sim.events.length;
        lastHighlight = highlight;
        $('#alerts').innerHTML = alerts(sim).slice(0, 12).map((a) => a.flightId
          ? `<li class="alert ${a.severity} pickable${lit(a.flightId)}" ${pickable(a.flightId)} role="button" title="Show this aircraft"><span class="t">${hhmm(a.minute)}</span> ${esc(a.text)}</li>`
          : `<li class="alert ${a.severity}"><span class="t">${hhmm(a.minute)}</span> ${esc(a.text)}</li>`).join('') || '<li class="empty">All quiet</li>';
      }

      // Stands
      $('#stands').innerHTML = standsStatus(sim).map((s) => {
        const what = s.kind === 'holdingBay' ? `Holding Bay ${s.id}` : `Stand ${s.id} (${s.serves === 'terminal' ? 'Terminal' : 'Cargo Hub'})`;
        const tip = `${what} · ${s.size} · ${s.state}${s.aircraft ? ` · ${s.flightId} ${s.aircraft}` : ''}`;
        // state in words and a symbol, not only in colour
        const status = s.state === 'free' ? '○ free' : `${s.state === 'busy' ? '●' : '◐'} ${s.flightId ? callsignOf(sim, s.flightId) : ''}`;
        return `<span class="spot ${s.state}${s.kind === 'holdingBay' ? ' bay' : ''}" title="${esc(tip)}"><b>${esc(s.id)}</b><small>${SIZE[s.size]}</small><span class="who">${esc(status)}</span></span>`;
      }).join('');

      // Runway and wind chips
      const statuses = runwayStatuses(sim);
      const rw = statuses[0]!;
      const label = (r: typeof rw) => ({ open: 'OPEN', blocked: `BLOCKED until ${r.until !== null ? hhmm(r.until) : ''}`, dark: 'CLOSED (dark)', curfew: 'CURFEW', unconnected: 'NOT CONNECTED', ilsOnly: 'NO LANDINGS (ILS only)', changeover: 'CHANGING DIRECTION' })[r.state];
      const tip = (r: typeof rw) => r.state === 'dark' ? 'Only Lit or ILS Runways work after 20:00'
        : r.state === 'blocked' ? 'Cleared faster with a Fire & Rescue Station'
        : r.state === 'unconnected' ? 'Needs Taxiway connectors at both ends'
        : r.state === 'ilsOnly' ? 'Bad weather: only ILS Runways can take landings'
        : r.state === 'changeover' ? 'The wind changed: the Runway is being turned round (a few minutes)' : 'Landing and taking off into the wind';
      $('#runway-chip').outerHTML = `<span id="runway-chip" class="chip-group">${statuses.map((r) =>
        `<span class="chip ${r.state}" title="${esc(tip(r))}">RWY ${esc(r.name)} ${label(r)}</span>`).join('')}</span>`;
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
    const who = `${esc(callsignOf(sim, alert.flightId))} (${f?.type ?? ''})`;
    banner.hidden = false;
    banner.className = `alert-banner ${alert.kind}`;
    if (alert.kind === 'fuel') {
      banner.innerHTML = `<b>LOW FUEL</b><span>${who} has ${Math.ceil(f?.fuelMinutes ?? 0)} min of fuel left. Divert it now (no fees, no Movement, no fine), or declare a Mayday: it lands next and every Runway waits for it, but if the landing goes wrong it crashes, with no fuel to go around.</span>
        <div class="alert-actions"><button type="button" data-fuel="divert" aria-keyshortcuts="D">Divert <kbd>D</kbd></button><button type="button" data-ack class="danger" aria-keyshortcuts="M">Mayday landing <kbd>M</kbd></button></div>`;
    } else if (alert.kind === 'emergency') {
      banner.innerHTML = `<b>EMERGENCY ALERT</b><span>${who} is about to crash. Intervene for a second roll (${Math.round(secondRollChance(sim.controllerTrainingLevel) * 100)}% to save it).</span>
        <div class="alert-actions"><button type="button" data-ack>Intervene</button></div>`;
    } else {
      const events = alert.events ?? [];
      const worst = events.some((e) => e.kind === 'crash') ? 'CRASH' : events.some((e) => e.kind === 'incident' || e.kind === 'taxiIncident') ? 'INCIDENT' : 'DIVERSION';
      const blocked = runwayStatuses(sim).filter((r) => r.state === 'blocked');
      const cost = events.reduce((n, e) => n + e.cost, 0);
      const advice = worst === 'DIVERSION'
        ? 'Diverted aircraft bring no fees or Movements.'
        : blocked.length ? `${blocked.map((r) => `RWY ${r.name} blocked until ${r.until !== null ? hhmm(r.until) : ''}`).join(', ')}. A Fire & Rescue Station clears it faster.` : '';
      banner.innerHTML = `<b>${worst}</b><span>${events.map((e) => esc(describeEvent(sim, e))).join('<br>')}${cost ? `<br>Cost: −$${cost.toLocaleString('en-US')}` : ''}${advice ? `<br><small>${esc(advice)}</small>` : ''}</span>
        <div class="alert-actions"><button type="button" data-ack>Continue</button></div>`;
    }
    banner.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }

  return view;
}
