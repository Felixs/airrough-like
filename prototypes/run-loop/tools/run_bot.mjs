import fs from 'fs';
const code = fs.readFileSync(new URL('../sim.js', import.meta.url), 'utf8');
const { LiveDay, RunLoop } = new Function(code + '\nreturn { LiveDay, RunLoop };')();
const policy = process.argv[2] || 'idle', start = process.argv[3] || 'allrounder', seed = +(process.argv[4] || 1);
let run = RunLoop.newRun({ start, seed });
const buyFirst = (prefixes) => { for (const p of prefixes) { const it = RunLoop.shop(run).find(i => i.key.startsWith(p) && i.ok); if (it) { run = RunLoop.reduce(run, { type: 'build', key: it.key }); return it.label; } } return null; };
const buys = [];
while (!run.over) {
  if (policy === 'greedy' || policy === 'smart') { const m0 = run.money; run = structuredClone(run); RunLoop.autoBuild(run, policy === 'smart'); if (run.money !== m0) buys.push(`W${run.week}D${run.dow} spent ${m0 - run.money}`); }
  run = RunLoop.reduce(run, { type: 'playDay' });
  const r = run.lastReport;
  console.log(`W${r.week} ${LiveDay.DAYS[r.dow].slice(0,3)} ${LiveDay.TWISTS[r.twist].name.slice(0,28).padEnd(28)} fl ${String(r.meta.mix.slice(1).join('/')).padEnd(8)} skip ${r.meta.skipped.slice(1).join('/')} swap ${r.meta.swapped} | fees ${String(r.fees).padStart(6)} upk ${r.upkeep} net ${String(r.net).padStart(6)} money ${String(run.money).padStart(7)} | crash ${r.stats.crashes} div ${r.stats.diversions} fuelAl ${r.stats.fuelAlerts} mv ${r.movements}/${r.quota}${r.lost ? ' LOST' : ''} fine ${r.stats.crashFines} clDiv ${r.stats.closedDiversions}`);
}
console.log(policy, start, seed, run.won ? 'WON' : 'LOST', JSON.stringify(RunLoop.score(run)), 'spent', run.spent);
if (buys.length) console.log(buys.join('\n'));
if (process.env.V) for (const r of run.history.filter(Boolean)) if (r.events.length) console.log(`W${r.week}D${r.dow}:\n  ` + r.events.join('\n  '));
