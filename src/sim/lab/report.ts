/**
 * Balance lab: turns Run results into numbers per player and variant, a Markdown summary and a self-contained HTML
 * report (tables and small SVG charts, no libraries).
 */
import type { Experiment } from './experiments';
import type { LossCause, RunResult } from './play';

export interface Row {
  readonly player: string;
  readonly variant: string;
  readonly runs: number;
  readonly wins: number;
  readonly winRate: number;
  /** Wilson 95% interval for the win rate. */
  readonly winLow: number;
  readonly winHigh: number;
  readonly medianDays: number;
  /** Runs lost on each Day index (0 = Week 1 Monday). */
  readonly lossDays: readonly number[];
  readonly causes: Readonly<Partial<Record<LossCause, number>>>;
  /** Mean Movements / Quota per Day index over the Runs still going that Day. */
  readonly margins: readonly number[];
  readonly meanSpent: number;
  readonly meanFinalMoney: number;
  /** Mean money spent per kind of purchase. */
  readonly spentOn: Readonly<Record<string, number>>;
}

export function wilson(wins: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** What kind of thing a purchase was, for grouping ("upgrade radar 3" → "upgrade radar"). */
const kindOf = (what: string) => what.replace(/ \d+$/, '').replace(/^(small|medium|large) (passenger|cargo) Stand$/, 'Stands')
  .replace(/^(Terminal|Cargo) pier \+ .*$/, 'piers').replace(/^(small|medium|large) Holding Bay$/, 'Holding Bays');

export function summarize(results: readonly RunResult[]): Row[] {
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    const k = `${r.player}\u0000${r.variant}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((rs) => {
    const wins = rs.filter((r) => r.won).length;
    const [winLow, winHigh] = wilson(wins, rs.length);
    const lossDays = Array.from({ length: 28 }, (_, d) => rs.filter((r) => r.lostOn === d).length);
    const causes: Partial<Record<LossCause, number>> = {};
    for (const r of rs) if (r.lossCause) causes[r.lossCause] = (causes[r.lossCause] ?? 0) + 1;
    const margins = Array.from({ length: 28 }, (_, d) => {
      const alive = rs.flatMap((r) => (r.days[d] ? [r.days[d]!.margin] : []));
      return alive.length ? alive.reduce((a, b) => a + b, 0) / alive.length : NaN;
    });
    const spentOn: Record<string, number> = {};
    for (const r of rs) for (const p of r.purchases) spentOn[kindOf(p.what)] = (spentOn[kindOf(p.what)] ?? 0) + p.cost / rs.length;
    return {
      player: rs[0]!.player, variant: rs[0]!.variant, runs: rs.length, wins, winRate: wins / rs.length, winLow, winHigh,
      medianDays: median(rs.map((r) => r.daysSurvived)), lossDays, causes, margins,
      meanSpent: rs.reduce((n, r) => n + r.purchases.reduce((m, p) => m + p.cost, 0), 0) / rs.length,
      meanFinalMoney: rs.reduce((n, r) => n + r.finalMoney, 0) / rs.length,
      spentOn,
    };
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const k = (x: number) => `${Math.round(x / 1000).toLocaleString('en-US')}k`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dayName = (d: number) => `W${Math.floor(d / 7) + 1} ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d % 7]}`;

export function markdown(exp: Experiment, rows: readonly Row[], seeds: number): string {
  const lines = [
    `## ${exp.title}`, '', `_${exp.question}_ · ${seeds} seeds`, '',
    '| Player | Variant | Win rate (95% CI) | Median Days | Lost most on | Main loss cause | Spent / Run |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const worst = r.lossDays.indexOf(Math.max(...r.lossDays));
    const cause = Object.entries(r.causes).sort((a, b) => b[1] - a[1])[0];
    lines.push(`| ${r.player} | ${r.variant} | ${pct(r.winRate)} (${pct(r.winLow)}–${pct(r.winHigh)}) | ${r.medianDays} | ${r.wins === r.runs ? '–' : dayName(worst)} | ${cause ? `${cause[0]} (${cause[1]})` : '–'} | ${k(r.meanSpent)} |`);
  }
  return lines.join('\n');
}

const COLOURS = ['#3fb8a6', '#f0b54a', '#ff6b5e', '#8fa8ff', '#c792ea', '#9ccc65', '#e0e0e0'];

/** Mean margin per Day, one line per row, with the Quota line at 1. */
function marginChart(rows: readonly Row[]): string {
  const W = 640, H = 200, max = 1.6;
  const x = (d: number) => 30 + (d / 27) * (W - 40);
  const y = (m: number) => H - 20 - (Math.min(max, m) / max) * (H - 30);
  const lines = rows.map((r, i) => {
    const pts = r.margins.flatMap((m, d) => (Number.isNaN(m) ? [] : [`${x(d).toFixed(1)},${y(m).toFixed(1)}`]));
    return `<polyline fill="none" stroke="${COLOURS[i % COLOURS.length]}" stroke-width="2" points="${pts.join(' ')}"><title>${esc(`${r.player} · ${r.variant}`)}</title></polyline>`;
  }).join('');
  const weeks = [7, 14, 21].map((d) => `<line x1="${x(d - 0.5)}" x2="${x(d - 0.5)}" y1="10" y2="${H - 20}" stroke="#2a3a35"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Mean Movements over Quota by Day">${weeks}
    <line x1="30" x2="${W - 10}" y1="${y(1)}" y2="${y(1)}" stroke="#ff6b5e" stroke-dasharray="4 3"/><text x="2" y="${y(1) + 4}">Quota</text>
    ${lines}${[0, 7, 14, 21].map((d) => `<text x="${x(d)}" y="${H - 4}">W${d / 7 + 1}</text>`).join('')}</svg>`;
}

function lossBars(r: Row): string {
  const max = Math.max(1, ...r.lossDays);
  return `<svg viewBox="0 0 140 24" class="bars">${r.lossDays.map((n, d) => `<rect x="${d * 5}" y="${24 - (n / max) * 22}" width="4" height="${(n / max) * 22}" fill="${d % 7 >= 5 ? '#ff6b5e' : '#f0b54a'}"><title>${dayName(d)}: ${n}</title></rect>`).join('')}</svg>`;
}

export function html(sections: ReadonlyArray<{ exp: Experiment; rows: readonly Row[]; seeds: number }>, meta: { build: string; date: string }): string {
  const body = sections.map(({ exp, rows, seeds }) => `
    <section><h2>${esc(exp.title)}</h2><p class="q">${esc(exp.question)} · ${seeds} seeds per row</p>
    <table><thead><tr><th>Player</th><th>Variant</th><th>Win rate</th><th>95% CI</th><th>Median Days</th><th>Losses by Day (Sat/Sun red)</th><th>Loss causes</th><th>Spent / Run</th><th>Money left</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr><td><i style="background:${COLOURS[i % COLOURS.length]}"></i>${esc(r.player)}</td><td>${esc(r.variant)}</td><td><b>${pct(r.winRate)}</b></td><td>${pct(r.winLow)}–${pct(r.winHigh)}</td><td>${r.medianDays}</td><td>${lossBars(r)}</td>
      <td>${Object.entries(r.causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ') || '–'}</td><td>${k(r.meanSpent)}</td><td>${k(r.meanFinalMoney)}</td></tr>`).join('')}
    </tbody></table>
    <h3>Movements ÷ Quota by Day (mean over Runs still going)</h3>${marginChart(rows)}
    <h3>Where the money went (mean per Run)</h3><table class="spend"><thead><tr><th>Player · Variant</th>${[...new Set(rows.flatMap((r) => Object.keys(r.spentOn)))].map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(`${r.player} · ${r.variant}`)}</td>${[...new Set(rows.flatMap((x) => Object.keys(x.spentOn)))].map((s) => `<td>${r.spentOn[s] ? k(r.spentOn[s]!) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </section>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Balance lab</title><style>
    body{margin:0;padding:24px;background:#0f1614;color:#dfe8e4;font:13px/1.45 ui-monospace,Menlo,monospace}
    h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 4px;color:#3fb8a6}h3{font-size:12px;color:#8fa8a0;text-transform:uppercase;letter-spacing:.08em;margin:16px 0 6px}
    .q{color:#8fa8a0;margin:0 0 10px}table{border-collapse:collapse;width:100%;max-width:1200px}th,td{padding:5px 8px;border-bottom:1px solid #22302b;text-align:left;vertical-align:middle}
    th{color:#8fa8a0;font-weight:400}td i{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:2px}.bars{width:140px;height:24px}
    .chart{width:100%;max-width:700px;background:#121b18;border-radius:6px}.chart text{fill:#8fa8a0;font-size:10px}.meta{color:#8fa8a0}
    section{border-top:1px solid #22302b;margin-top:16px}</style></head><body>
    <h1>Balance lab</h1><p class="meta">build ${esc(meta.build)} · ${esc(meta.date)} · scripted players in docs/balance-lab.md</p>${body}</body></html>`;
}
