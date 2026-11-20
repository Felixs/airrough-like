/**
 * Balance lab entry point: what the runner script (scripts/balance.mjs) calls. See docs/balance-lab.md.
 */
import { experimentById } from './experiments';
import { playRun, type RunResult } from './play';
import { playerById } from './players';

export { EXPERIMENTS, TARGETS, experimentById } from './experiments';
export { html, markdown, summarize } from './report';

/** One Run of an experiment: a player, a variant (by label) and a seed. */
export interface Task {
  readonly experiment: string;
  readonly player: string;
  readonly variant: string;
  readonly seed: number;
}

export function tasksFor(experimentId: string, seeds: number, firstSeed = 1): Task[] {
  const exp = experimentById(experimentId);
  return exp.players.flatMap((player) => exp.variants.flatMap((v) =>
    Array.from({ length: seeds }, (_, i) => ({ experiment: exp.id, player, variant: v.label, seed: firstSeed + i }))));
}

export function runTask(task: Task): RunResult {
  const v = experimentById(task.experiment).variants.find((x) => x.label === task.variant);
  if (!v) throw new Error(`Unknown variant: ${task.variant}`);
  return playRun(playerById(task.player), task.seed, { overrides: v.overrides ?? {}, meta: v.meta ?? 'none', variant: v.label });
}
