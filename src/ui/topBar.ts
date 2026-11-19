import type { Speed } from '../sim/clock';

export interface TopBar {
  showClock(text: string, dayOver: boolean): void;
}

/** Wires the top bar's speed buttons and returns a small view to update the clock. */
export function mountTopBar(root: HTMLElement, initial: Speed, onSpeed: (speed: Speed) => void): TopBar {
  const clock = root.querySelector<HTMLElement>('#clock')!;
  const status = root.querySelector<HTMLElement>('#day-status')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-speed]')];

  const select = (speed: Speed) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
    onSpeed(speed);
  };
  for (const b of buttons) b.addEventListener('click', () => select(Number(b.dataset.speed) as Speed));
  select(initial);

  return {
    showClock(text, dayOver) {
      clock.textContent = text;
      status.textContent = dayOver ? 'Day over' : '';
    },
  };
}
