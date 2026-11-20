// Balance lab runner: plays experiments with scripted players over many seeds and writes a report.
//   node scripts/balance.mjs [experiment ...|all] [--seeds 30] [--workers N] [--first-seed 1] [--out balance-report]
// Compiles src/sim (pure TypeScript) with the project's TypeScript into .balance/, then plays in worker threads.
// Experiments, players and targets: src/sim/lab/, explained in docs/balance-lab.md.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, '.balance');
const lab = () => createRequire(import.meta.url)(join(build, 'out', 'sim', 'lab', 'index.js'));

if (!isMainThread) {
  const { runTask } = lab();
  parentPort.on('message', (task) => {
    if (task === null) process.exit(0);
    parentPort.postMessage({ ...runTask(task), experiment: task.experiment });
  });
  parentPort.postMessage('ready');
} else {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args.splice(i, 2)[1] : fallback;
  };
  const seeds = Number(opt('seeds', 30));
  const firstSeed = Number(opt('first-seed', 1));
  const workers = Number(opt('workers', Math.max(1, availableParallelism())));
  const out = resolve(root, opt('out', 'balance-report'));

  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'CommonJS', strict: true, skipLibCheck: true,
      outDir: 'out', rootDir: '../src', types: [],
    },
    include: ['../src/sim/**/*.ts'],
    exclude: ['../src/sim/**/*.test.ts'],
  }, null, 2));
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(build, 'tsconfig.json')], { stdio: 'inherit' });
  writeFileSync(join(build, 'out', 'package.json'), '{ "type": "commonjs" }\n');

  const { EXPERIMENTS, tasksFor, summarize, markdown, html } = lab();
  const ids = !args.length || args.includes('all') ? EXPERIMENTS.map((e) => e.id) : args;
  const tasks = ids.flatMap((id) => tasksFor(id, seeds, firstSeed));
  console.log(`Balance lab: ${ids.join(', ')} · ${seeds} seeds · ${tasks.length} Runs on ${workers} workers`);

  const results = [];
  const started = Date.now();
  await new Promise((done) => {
    let next = 0;
    let running = 0;
    for (let w = 0; w < Math.min(workers, tasks.length); w++) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      running++;
      const feed = () => worker.postMessage(next < tasks.length ? tasks[next++] : null);
      worker.on('message', (msg) => {
        if (msg !== 'ready') {
          results.push(msg);
          if (results.length % 10 === 0 || results.length === tasks.length) {
            const s = (Date.now() - started) / 1000;
            console.log(`  ${results.length}/${tasks.length} Runs · ${s.toFixed(0)} s`);
          }
        }
        feed();
      });
      worker.on('exit', () => --running === 0 && done());
      worker.on('error', (e) => { console.error(e); process.exitCode = 1; });
    }
  });

  mkdirSync(out, { recursive: true });
  const sections = ids.map((id) => {
    const exp = EXPERIMENTS.find((e) => e.id === id);
    const mine = results.filter((r) => r.experiment === id);
    // keep the experiment's order of players and variants
    const order = (r) => exp.players.indexOf(r.player) * 100 + exp.variants.findIndex((v) => v.label === r.variant);
    const rows = summarize(mine).sort((a, b) => order(a) - order(b));
    return { exp, rows, seeds, results: mine };
  });
  const buildId = process.env.GITHUB_SHA?.slice(0, 7) ?? 'local';
  writeFileSync(join(out, 'index.html'), html(sections, { build: buildId, date: new Date().toISOString().slice(0, 16).replace('T', ' ') }));
  const md = sections.map((s) => markdown(s.exp, s.rows, seeds)).join('\n\n');
  writeFileSync(join(out, 'summary.md'), `${md}\n`);
  writeFileSync(join(out, 'results.json'), JSON.stringify(sections.map((s) => ({ experiment: s.exp.id, rows: s.rows, runs: s.results })), null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `# Balance lab\n\n${md}\n`, { flag: 'a' });
  console.log(`\n${md}\n\nReport: ${join(out, 'index.html')}`);
}
