import { runInfo, type RunState } from '../sim/run';

/** The build id (commit or date), injected at build time. */
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

/** Copies text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** A small "Seed 12345 ⧉" button; clicking copies the bug-report info for the Run. */
export function seedButton(run: RunState): string {
  return `<button type="button" class="seed-chip" data-copy-seed title="Copy bug-report info: ${runInfo(run, BUILD)}">Seed ${run.seed} ⧉</button>`;
}

/** Wires every seed button inside `root` (call after rendering). */
export function wireSeedButtons(root: HTMLElement, run: () => RunState): void {
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-copy-seed]');
    if (!b) return;
    const text = runInfo(run(), BUILD);
    void copyText(text).then((ok) => {
      const before = b.textContent;
      b.textContent = ok ? 'Copied ✓' : text;
      if (ok) setTimeout(() => (b.textContent = before), 1500);
    });
  });
}
