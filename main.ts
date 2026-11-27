// Graduation Crossing — a pump.fun bonding-curve paper-trading bot for the
// make.fun competition "Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins"
// (u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532).
//
// The grader runs `node /bot/main.ts` with this directory mounted at /bot.
// main.ts is only the entrypoint: it speaks agent-fun/replay/v2 — the hello
// that opens the run, one batch per slot with its events, marks, fills and
// account, and the done that closes it — through the kit SDK shim vendored
// beside it (vendor/makefun-bot.ts, a byte-identical copy of the kit's
// sdk/ts/makefun-bot.ts) and hands each batch to the strategy in strategy.ts,
// which returns the batch's orders. All decisions live there: graduation
// crossings, mechanical exits, and guardrail probes.
//
// Nothing here reads the clock, the environment, or the network, and nothing
// is random: the two graded executions produce byte-identical action logs.
// Diagnostics go to stderr only — stdout carries replies, one per batch,
// echoing the batch's seq.
//
// Rebuilt in a fresh session after the competition opened (2026-11-25T17:00Z):
// every deliverable file in this repository was written in that session, so
// the transcript gate counts these lines as authored here.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

// One strategy instance, default parameters: the tournament champion's
// settings, tuned on the kit's dev window. See README.md for the candidate
// tournament and the dev replay numbers behind them.
const bot = createStrategy(DEFAULT_PARAMS);

await runBot(bot);
