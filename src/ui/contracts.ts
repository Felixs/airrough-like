import { CONTRACT_RULES, contractDef, type ContractRef } from '../sim/contracts';
import type { RunState } from '../sim/run';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const KIND_LABEL = { standard: '', tradeOff: 'Trade-off', growth: 'Growth' } as const;

/** One Contract as a card (the offer) or a compact row (Plan Mode). */
export function contractCard(ref: ContractRef, index?: number): string {
  const def = contractDef(ref.id);
  const kind = KIND_LABEL[def.kind];
  const inner = `<span class="c-icon" aria-hidden="true">${def.icon}</span>
    <b class="c-name">${esc(def.name)}</b>${kind ? `<span class="c-kind ${def.kind}">${kind}</span>` : ''}
    <span class="c-gives">${esc(def.describe(ref.tier))}</span>
    ${def.catch ? `<span class="c-catch">Catch: ${esc(def.catch)}</span>` : ''}`;
  return index === undefined
    ? `<div class="contract">${inner}</div>`
    : `<button type="button" class="contract" data-contract="${index}" aria-keyshortcuts="${index + 1}">${inner}<span class="c-key">${index + 1}</span></button>`;
}

/**
 * After a won Week: "Week won, pick an Airline Contract". Three cards and a Skip button; `onChoice` gets the index
 * of the Contract signed, or null for Skip.
 */
export function showContractOffer(root: HTMLElement, run: RunState, onChoice: (index: number | null) => void): void {
  const offer = run.contractOffer ?? [];
  const won = run.history[run.history.length - 1]?.week ?? run.week - 1;
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Pick an Airline Contract');
  const signed = run.contracts ?? [];
  el.innerHTML = `
    <div class="card contract-offer">
      <button type="button" class="options-button corner" data-options aria-keyshortcuts="O" title="Options (O)">⚙ Options</button>
      <h2>Week ${won} won · pick an Airline Contract</h2>
      <p class="lead">It lasts the rest of the Run: it changes which flights come and pays a bonus, so you know which way to grow the airport.</p>
      <div class="contracts">${offer.map((c, i) => contractCard(c, i)).join('')}</div>
      <div class="offer-foot">
        ${signed.length ? `<span class="signed">Signed: ${signed.map((c) => `${contractDef(c.id).icon} ${esc(contractDef(c.id).name)}`).join(' · ')}</span>` : '<span></span>'}
        <button type="button" class="skip" aria-keyshortcuts="S">Skip · +$${CONTRACT_RULES.skipMoney.toLocaleString('en-US')}</button>
      </div>
    </div>`;
  const choose = (index: number | null) => {
    window.removeEventListener('keydown', onKey);
    el.remove();
    onChoice(index);
  };
  const onKey = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (n >= 1 && n <= offer.length) choose(n - 1);
    else if (e.key === 's' || e.key === 'S') choose(null);
  };
  window.addEventListener('keydown', onKey);
  for (const b of el.querySelectorAll<HTMLButtonElement>('button[data-contract]')) b.addEventListener('click', () => choose(Number(b.dataset.contract)));
  el.querySelector('button.skip')!.addEventListener('click', () => choose(null));
  root.appendChild(el);
  el.querySelector<HTMLButtonElement>('button[data-contract]')?.focus();
}
