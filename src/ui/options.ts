import { SONGS } from '../audio/music';
import { reduceMotion, type Options } from '../sim/save';

/** The Options fields (speed, pop-ups, music, background, motion), shared by the Main Menu and the in-game dialog. */
export function optionFields(options: Options): string {
  return `
          <label>Starting speed <select data-opt="defaultSpeed">${[1, 2, 4, 8].map((v) => `<option value="${v}"${options.defaultSpeed === v ? ' selected' : ''}>${v}×</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" data-opt="autoSlow" ${options.autoSlow ? 'checked' : ''}> Auto-slow: 1× while aircraft land or take off</label>
          <label class="check"><input type="checkbox" data-opt="eventPopups" ${options.eventPopups ? 'checked' : ''}> Pause with a pop-up on Incidents, Crashes and Diversions</label>
          <label>Music <select data-opt="music">${[['random', 'Random'], ...SONGS.map((s) => [s.id, s.title]), ['off', 'Off']].map(([v, l]) => `<option value="${v}"${(options.music ?? 'random') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Music volume <input type="range" min="0" max="100" step="5" data-opt="musicVolume" value="${options.musicVolume ?? 40}" aria-valuetext="${options.musicVolume ?? 40}%"></label>
          <label class="check"><input type="checkbox" data-opt="runInBackground" ${options.runInBackground ? 'checked' : ''}> Keep the Day running while the game's tab is hidden (otherwise it pauses)</label>
          <label class="check"><input type="checkbox" data-opt="reduceMotion" ${reduceMotion(options) ? 'checked' : ''}> Reduce motion: aircraft lights stay steady instead of flashing${options.reduceMotion === undefined ? ' <small>(following your system setting)</small>' : ''}</label>`;
}

/** Reads changes to the Options fields inside `el`; the volume follows its slider while dragged. */
export function wireOptionFields(el: HTMLElement, current: () => Options, onChange: (next: Options) => void): void {
  const onOption = (e: Event) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    const key = input.dataset.opt as keyof Options | undefined;
    if (!key) return;
    const options = current();
    const next: Options = key === 'defaultSpeed'
      ? { ...options, defaultSpeed: Number(input.value) as Options['defaultSpeed'] }
      : key === 'music' ? { ...options, music: input.value }
      : key === 'musicVolume' ? { ...options, musicVolume: Number(input.value) }
      : { ...options, [key]: (input as HTMLInputElement).checked };
    if (key === 'musicVolume') input.setAttribute('aria-valuetext', `${input.value}%`);
    onChange(next);
  };
  el.addEventListener('change', onOption);
  el.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).dataset.opt === 'musicVolume') onOption(e);
  });
}

/**
 * The Options as a dialog over the game (from Plan Mode or a Live Day): the same fields as the Main Menu's Options.
 * Esc or Close shuts it; `onClose` runs after.
 */
export function showOptionsDialog(root: HTMLElement, options: Options, onChange: (next: Options) => void, onClose: () => void): void {
  let current = options;
  const el = document.createElement('div');
  el.className = 'overlay options-dialog';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Options');
  el.innerHTML = `<div class="card"><h2>Options</h2><div class="options">${optionFields(current)}</div>
    <p class="lead">Reset progress is in the Main Menu's Options.</p>
    <button type="button" class="primary" data-close>Close <kbd>Esc</kbd></button></div>`;
  wireOptionFields(el, () => current, (next) => {
    current = next;
    onChange(next);
  });
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    el.remove();
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    } else e.stopPropagation(); // game keys (Space, speeds, Build tools) stay off while it is open; the fields still work
  };
  window.addEventListener('keydown', onKey, true);
  el.querySelector('[data-close]')!.addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
  root.appendChild(el);
  el.querySelector<HTMLElement>('select, input')?.focus();
}
