// Parameter grid sweep: score every combination of the strategy settings
// in a JSON grid against the kit's dev window and rank the combinations by
// mean net PnL. The final window's failed-tx draw is secret, so every
// setting is scored as the mean over several fail draws (and the worst of
// them), never on one lucky draw. The printout also shows the net with the
// single best round trip removed, so a setting that only wins through one
// lucky coin stands out.
//
//   node tools/sweep.ts <kit dir> '<base params json>' '<grid json: {"key":[v1,v2],...}>' [top N]

import type { Params } from '../strategy.ts';
import { createStrategy, DEFAULT_PARAMS } from '../strategy.ts';
import type { Dataset } from './sim.ts';
import { loadDataset, makeHello, simulate, phaseSeed } from './sim.ts';
import type { Hello } from '../vendor/makefun-bot.ts';

/** One grid combination with its dev-window scorecard. */
interface ScoredSetting {
  combo: Record<string, unknown>;
  meanNet: number;
  worstNet: number;
  exBest: number;
  exSecond: number;
  fills: number;
  coins: number;
  drawdown: number;
  trips: number;
  wins: number;
}

/** The fail draws every setting is averaged over. */
const FAIL_DRAWS = [11n, 22n, 33n, 44n];

/**
 * Score one combination: run it under every fail draw and fold the runs
 * into one row. Trips and wins are read off the last draw, fills and coins
 * are the smallest across draws, drawdown the largest — the same summary
 * the sweep has always printed.
 */
function scoreCombo(
  dataset: Dataset,
  opening: Hello,
  baseParams: Params,
  combo: Record<string, unknown>,
): ScoredSetting {
  let totalNet = 0;
  let worstNet = Infinity;
  let exBest = 0;
  let exSecond = 0;
  let fills = Infinity;
  let coins = Infinity;
  let drawdown = 0;
  let tripCount = 0;
  let winCount = 0;
  const tuned = { ...baseParams, ...combo } as Params;
  for (const failKey of FAIL_DRAWS) {
    const result = simulate(dataset, opening, createStrategy(tuned), { failKey });
    const tripPnls = result.trips.map((trip) => Number(trip.pnl) / 1e9).sort((a, b) => b - a);
    const net = Number(result.netPnl) / 1e9;
    totalNet += net;
    worstNet = Math.min(worstNet, net);
    exBest += (net - (tripPnls[0] ?? 0)) / FAIL_DRAWS.length;
    exSecond += (net - (tripPnls[0] ?? 0) - (tripPnls[1] ?? 0)) / FAIL_DRAWS.length;
    fills = Math.min(fills, result.fills);
    coins = Math.min(coins, result.mints);
    drawdown = Math.max(drawdown, result.maxDrawdown);
    tripCount = result.trips.length;
    winCount = result.trips.filter((trip) => trip.pnl > 0n).length;
  }
  return {
    combo,
    meanNet: totalNet / FAIL_DRAWS.length,
    worstNet,
    exBest,
    exSecond,
    fills,
    coins,
    drawdown,
    trips: tripCount,
    wins: winCount,
  };
}

const [kitDir, baseText, gridText, topText] = process.argv.slice(2);
if (kitDir === undefined || gridText === undefined) {
  console.error(`usage: node tools/sweep.ts <kit dir> '<base json>' '<grid json>' [top]`);
  process.exit(2); // kit directory or grid JSON missing
}

const baseParams = { ...DEFAULT_PARAMS, ...(JSON.parse(baseText ?? '{}') as Partial<Params>) };
const axes = JSON.parse(gridText) as Record<string, unknown[]>;
const dataset = loadDataset(kitDir);
const opening = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', dataset.sha256));

// Every combination of the grid axes, built one axis at a time in axis
// order, so the ranking order matches a nested loop over the axes.
let settings: Record<string, unknown>[] = [{}];
for (const name of Object.keys(axes)) {
  const widened: Record<string, unknown>[] = [];
  for (const combo of settings) {
    for (const value of axes[name]!) widened.push({ ...combo, [name]: value });
  }
  settings = widened;
}

const scored = settings.map((combo) => scoreCombo(dataset, opening, baseParams, combo));
scored.sort((a, b) => b.meanNet - a.meanNet);
for (const row of scored.slice(0, Number(topText ?? 25))) {
  console.log(
    `mean ${row.meanNet.toFixed(3)} worst ${row.worstNet.toFixed(3)} exBest ${row.exBest.toFixed(3)} ex2 ${row.exSecond.toFixed(3)} fills ${row.fills} coins ${row.coins} trips ${row.trips} wins ${row.wins} dd ${row.drawdown.toFixed(3)} ${JSON.stringify(row.combo)}`,
  );
}
