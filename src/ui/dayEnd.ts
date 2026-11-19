import type { RunState } from '../sim/run';
import { airMiles, runScore } from '../sim/run';
import { WEEKDAY_NAMES } from '../sim/schedule';

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function dayName(week: number, weekday: number): string {
  return `Week ${week} · ${WEEKDAY_NAMES[weekday] ?? ''}`;
}

/**
 * The Score Screen when the Run is lost (a plain Day report otherwise; Plan Mode normally shows that).
 */
export function showDayEnd(root: HTMLElement, run: RunState, onNext: () => void, onNewRun: () => void): void {
  const report = run.history[run.history.length - 1];
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const rows = (pairs: Array<[string, string]>) => pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (run.status === 'lost') {
    el.innerHTML = `
      <div class="card">
        <h2>Run over</h2>
        <p class="lead">${report ? `Daily Quota missed on ${dayName(report.week, report.weekday)}: ${report.movements} of ${report.quota} Movements.` : ''}</p>
        <dl>${rows([
          ['Days survived', String(run.stats.daysSurvived)],
          ['Movements', run.stats.movements.toLocaleString('en-US')],
          ['Fees earned', money(run.stats.fees)],
          ['Spending', money(run.stats.spending)],
          ['Crashes', String(run.stats.crashes)],
          ['Score', runScore(run).toLocaleString('en-US')],
          ['Air Miles', `+${airMiles(run).toLocaleString('en-US')}`],
        ])}</dl>
        <button type="button" class="primary">New Run</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="card">
        <h2>${report ? dayName(report.week, report.weekday) : ''} done</h2>
        <dl>${report ? rows([
          ['Movements / Quota', `${report.movements} / ${report.quota}`],
          ['Fees', money(report.fees)],
          ['Upkeep', money(-report.upkeep)],
          ['Fines & Incidents', money(-report.penalties)],
          ['Crashes · Diversions', `${report.crashes} · ${report.diversions}`],
          ['Money', money(run.money) + (run.inDebt ? ' (Debt: building blocked)' : '')],
        ]) : ''}</dl>
        <p class="lead">Next: ${dayName(run.week, run.weekday)}${run.weekday === 6 ? ' (Boss Day)' : run.weekday === 5 ? ' (Rush Day)' : ''}</p>
        <button type="button" class="primary">Next Day</button>
      </div>`;
  }
  el.querySelector('button')!.addEventListener('click', () => {
    el.remove();
    (run.status === 'lost' ? onNewRun : onNext)();
  });
  root.appendChild(el);
  el.querySelector<HTMLButtonElement>('button')!.focus();
}
