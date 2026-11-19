import type { RunState } from '../sim/run';
import { dayName } from './dayEnd';

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** Offers to resume a saved Run after a reload. */
export function showResume(root: HTMLElement, run: RunState, onResume: () => void, onNew: () => void): void {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="card">
      <h2>Resume your Run?</h2>
      <p class="lead">${run.status === 'won' ? 'Won Run' : `Next: ${dayName(run.week, run.weekday)}`}${run.endless ? ' · Endless' : ''} · ${money(run.money)} · ${run.stats.daysSurvived} Days survived</p>
      <div class="score-buttons">
        <button type="button" class="primary" data-act="resume">Resume</button>
        <button type="button" class="secondary" data-act="new">New Run</button>
      </div>
    </div>`;
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')?.dataset.act;
    if (!act) return;
    el.remove();
    (act === 'resume' ? onResume : onNew)();
  });
  root.appendChild(el);
  el.querySelector<HTMLButtonElement>('button')!.focus();
}

/** A short message in the corner that fades away. */
export function showNotice(root: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'notice';
  el.setAttribute('role', 'status');
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
