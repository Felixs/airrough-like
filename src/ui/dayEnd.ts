import type { RunState } from '../sim/run';
import { airMiles, runScore } from '../sim/run';
import { WEEKDAY_NAMES } from '../sim/schedule';

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function dayName(week: number, weekday: number): string {
  return `Week ${week} · ${WEEKDAY_NAMES[weekday] ?? ''}`;
}

export interface ScoreScreenHandlers {
  onNewRun(): void;
  /** Only offered after a win. */
  onEndless(): void;
}

/** The Score Screen when a Run is lost or won (a won Run can continue into Endless Mode). */
export function showScoreScreen(root: HTMLElement, run: RunState, handlers: ScoreScreenHandlers): void {
  const report = run.history[run.history.length - 1];
  const won = run.status === 'won';
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const rows = (pairs: Array<[string, string]>) => pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const lead = won
    ? 'You survived all four Weeks. Bank the Score now, or keep going in Endless Mode.'
    : report
      ? `Daily Quota missed on ${dayName(report.week, report.weekday)}${run.endless ? ' (Endless)' : ''}: ${report.movements} of ${report.quota} Movements.`
      : '';
  el.innerHTML = `
    <div class="card">
      <h2>${won ? 'Run won!' : 'Run over'}</h2>
      <p class="lead">${lead}</p>
      <dl>${rows([
        ['Days survived', String(run.stats.daysSurvived)],
        ['Movements', run.stats.movements.toLocaleString('en-US')],
        ['Fees earned', money(run.stats.fees)],
        ['Spending', money(run.stats.spending)],
        ['Crashes', String(run.stats.crashes)],
        ['Score', runScore(run).toLocaleString('en-US')],
        ['Air Miles', `+${airMiles(run).toLocaleString('en-US')}`],
      ])}</dl>
      <div class="score-buttons">
        ${won ? '<button type="button" class="primary" data-act="endless">Continue in Endless Mode</button>' : ''}
        <button type="button" class="${won ? 'secondary' : 'primary'}" data-act="new">New Run</button>
      </div>
    </div>`;
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')?.dataset.act;
    if (!act) return;
    el.remove();
    if (act === 'endless') handlers.onEndless();
    else handlers.onNewRun();
  });
  root.appendChild(el);
  el.querySelector<HTMLButtonElement>('button')!.focus();
}
