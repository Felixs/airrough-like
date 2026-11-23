import { parseSpeed, type Speed } from '../sim/clock';

export interface TopBar {
  showClock(text: string, dayOver: boolean): void;
  setSpeed(speed: Speed): void;
}

/** Wires the top bar's speed buttons and returns a small view to update the clock. */
export function mountTopBar(root: HTMLElement, initial: Speed, onSpeed: (speed: Speed) => void): TopBar {
  const clock = root.querySelector<HTMLElement>('#clock')!;
  const status = root.querySelector<HTMLElement>('#day-status')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-speed]')];

  const select = (speed: Speed) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(parseSpeed(b.dataset.speed) === speed));
    onSpeed(speed);
  };
  for (const b of buttons) {
    const speed = parseSpeed(b.dataset.speed);
    if (speed !== undefined) b.addEventListener('click', () => select(speed));
  }
  select(initial);

  return {
    setSpeed: select,
    showClock(text, dayOver) {
      // called every frame: touch the page only when something changed
      const now = dayOver ? 'Day over' : '';
      if (clock.textContent !== text) clock.textContent = text;
      if (status.textContent !== now) status.textContent = now;
    },
  };
}
