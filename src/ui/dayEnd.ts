import type { RunState } from '../sim/run';
import { airMiles, runScore } from '../sim/run';
import { WEEKDAY_NAMES } from '../sim/schedule';
import { daySections, kpi, reportTabs, wireReportTabs } from './dayReport';
import { seedButton, wireSeedButtons } from './seed';

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function dayName(week: number, weekday: number): string {
  return `Week ${week} · ${WEEKDAY_NAMES[weekday] ?? ''}`;
}

export interface ScoreScreenHandlers {
  /** Back to the Main Menu. */
  onFinish(): void;
  /** Only offered after a win. */
  onEndless(): void;
}

/** The end of a Run: the last Day's report, marked won or lost, plus the Run's totals, Score and Air Miles. */
export function showScoreScreen(root: HTMLElement, run: RunState, handlers: ScoreScreenHandlers): void {
  const won = run.status === 'won';
  const last = run.history[run.history.length - 1];
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', won ? 'Run won' : 'Run over');
  const rows = (pairs: Array<[string, string]>) => pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  el.innerHTML = `
    <div class="card report score ${won ? 'won' : 'lost'}">
      <button type="button" class="options-button corner" data-options aria-keyshortcuts="O" title="Options (O)">⚙ Options</button>
      <div class="banner">${won ? '🏆 Run won' : '✈ Run over'}<small>${won
        ? 'You survived all four Weeks. Finish now, or keep going in Endless Mode.'
        : `The Daily Quota was missed${run.endless ? ' in Endless Mode' : ''}.`}</small></div>
      ${reportTabs(`
        <div class="kpis">
          ${kpi('Score', runScore(run).toLocaleString('en-US'))}
          ${kpi('Air Miles earned', `✈ ${airMiles(run).toLocaleString('en-US')}`, 'Spend them in the Main Menu', 'ok')}
          ${kpi('Days survived', String(run.stats.daysSurvived), `${run.stats.movements.toLocaleString('en-US')} Movements`)}
        </div>${last && !won ? `<p class="lead">${dayName(last.week, last.weekday)}: ${last.movements} of ${last.quota} Movements, ${last.quota - last.movements} short of the Quota.</p>` : ''}`, `
      <section><h3>This Run</h3><dl class="totals">${rows([
        ['Days survived', String(run.stats.daysSurvived)],
        ['Movements', run.stats.movements.toLocaleString('en-US')],
        ['Fees earned', money(run.stats.fees)],
        ['Spending', money(run.stats.spending)],
        ['Crashes · Diversions', `${run.stats.crashes} · ${run.stats.diversions}`],
        ['Score', runScore(run).toLocaleString('en-US')],
        ['Air Miles earned', `✈ ${airMiles(run).toLocaleString('en-US')}`],
      ])}</dl></section>
      <h3>The last Day</h3>
      ${daySections(run)}
      <p class="seed-line">${seedButton(run)} <small>Play this Run again with the same seed from the Main Menu, or send it with a bug report.</small></p>`)}
      <div class="score-buttons">
        ${won ? '<button type="button" class="primary" data-act="endless">Continue in Endless Mode</button>' : ''}
        <button type="button" class="${won ? 'secondary' : 'primary'}" data-act="finish">Finish Run</button>
      </div>
    </div>`;
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')?.dataset.act;
    if (!act) return;
    el.remove();
    if (act === 'endless') handlers.onEndless();
    else handlers.onFinish();
  });
  root.appendChild(el);
  wireSeedButtons(el, () => run);
  wireReportTabs(el);
  el.querySelector<HTMLButtonElement>('.score-buttons button')!.focus();
}
