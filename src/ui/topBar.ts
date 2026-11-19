import { parseSpeed, type Speed } from '../sim/clock';

export interface TopBar {
  showClock(text: string, dayOver: boolean): void;
  showStats(money: number, movements: number, quota: number): void;
}

/** Wires the top bar's speed buttons and returns a small view to update the clock. */
export function mountTopBar(root: HTMLElement, initial: Speed, onSpeed: (speed: Speed) => void): TopBar {
  const clock = root.querySelector<HTMLElement>('#clock')!;
  const status = root.querySelector<HTMLElement>('#day-status')!;
  const money = root.querySelector<HTMLElement>('#money')!;
  const movements = root.querySelector<HTMLElement>('#movements')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-speed]')];

  const select = (speed: Speed) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
    onSpeed(speed);
  };
  for (const b of buttons) {
    const speed = parseSpeed(b.dataset.speed);
    if (speed !== undefined) b.addEventListener('click', () => select(speed));
  }
  select(initial);

  return {
    showClock(text, dayOver) {
      clock.textContent = text;
      status.textContent = dayOver ? 'Day over' : '';
    },
    showStats(m, mv, q) {
      money.textContent = Math.round(m).toLocaleString('en-US');
      movements.textContent = `${mv} / ${q}`;
      movements.classList.toggle('met', mv >= q);
    },
  };
}
