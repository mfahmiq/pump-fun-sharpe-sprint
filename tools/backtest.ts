// Backtest harness: run strategy.ts over the kit's dev window using the
// local replay engine ported into tools/sim.ts, and print the headline
// numbers (net PnL, fills, coins, drawdown, reject reasons). Pass --trips
// to also list every completed round trip, one per line.
//
//   node tools/backtest.ts <kit dir> ['{"stakeSol":0.4}'] [--trips]

import type { Params } from '../strategy.ts';
import { createStrategy, DEFAULT_PARAMS } from '../strategy.ts';
import { loadDataset, makeHello, simulate, phaseSeed } from './sim.ts';

const kitDir = process.argv[2];
if (kitDir === undefined) {
  console.error(`usage: node tools/backtest.ts <kit dir> [params json] [--trips]`);
  process.exit(2); // no kit directory given
}

// An optional JSON blob in argv[3] overrides individual parameters; any
// other third argument is ignored, so `--trips` still works on its own.
const thirdArg = process.argv[3];
const overrides: Partial<Params> =
  thirdArg !== undefined && thirdArg.startsWith('{') ? (JSON.parse(thirdArg) as Partial<Params>) : {};

const dataset = loadDataset(kitDir);
const opening = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', dataset.sha256));
const settings = { ...DEFAULT_PARAMS, ...overrides };
const engine = createStrategy(settings);
const outcome = simulate(dataset, opening, engine);
console.error(`stats ${JSON.stringify(engine.stats())}`);

/** Lamports to a 6-decimal SOL string, the unit every printout uses. */
function formatSol(amount: bigint): string {
  return (Number(amount) / 1e9).toFixed(6);
}

const winningTrips = outcome.trips.filter((trip) => trip.pnl > 0n).length;
console.log(`net ${formatSol(outcome.netPnl)} SOL  fills ${outcome.fills}  coins ${outcome.mints}  trips ${outcome.trips.length}  wins ${winningTrips}  dd ${outcome.maxDrawdown.toFixed(4)}  rejected ${outcome.rejected} ${JSON.stringify(outcome.rejectReasons)}  failed ${outcome.failed}`);

// The same run twice more, for context: once with the failed-tx draw
// switched off, once with every fee doubled.
const cleanRun = simulate(dataset, opening, createStrategy(settings), { failKey: null });
const priceyRun = simulate(dataset, opening, createStrategy(settings), { feeMultiplier: 2n });
console.log(`without failed txs ${formatSol(cleanRun.netPnl)}  at 2x fees ${formatSol(priceyRun.netPnl)}`);

const listTrips = process.argv.includes('--trips');
if (listTrips) {
  for (const trip of outcome.trips) {
    console.log(trip.mint, trip.open, trip.close - trip.open, formatSol(trip.pnl));
  }
}
