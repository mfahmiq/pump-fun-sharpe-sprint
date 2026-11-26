// Conviction + Absorption — a pump.fun bonding-curve paper-trading bot for the
// make.fun competition "Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins"
// (u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532).
//
// The grader runs `node /bot/main.ts` with this directory mounted at /bot.
// main.ts is only the entrypoint: it speaks agent-fun/replay/v2 through the kit
// SDK shim vendored beside it (vendor/makefun-bot.ts, a byte-identical copy of
// the kit's sdk/ts/makefun-bot.ts) and hands the wire to the strategy in
// strategy.ts. All decisions live there: creator-conviction entries, sell
// absorption entries, fast mechanical exits, and guardrail probes.
//
// Nothing here reads the clock, the environment, or the network, and nothing
// is random: the two graded executions produce byte-identical action logs.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

// One strategy instance, default parameters: the settings the dev-window
// backtest (tools/backtest.ts) and the kit's grade-local run were tuned on.
// See README.md for the dev replay numbers behind them.
const bot = createStrategy(DEFAULT_PARAMS);

await runBot(bot);
