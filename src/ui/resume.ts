/** A short message in the corner that fades away. */
export function showNotice(root: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'notice';
  el.setAttribute('role', 'status');
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
