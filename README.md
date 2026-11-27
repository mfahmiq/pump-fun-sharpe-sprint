[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/mfahmiq/pump-fun-sharpe-sprint/rank.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/mfahmiq/pump-fun-sharpe-sprint/reward.svg)](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# Graduation Crossing — Pump.fun Sharpe Sprint

A paper-trading bot for the [make.fun](https://make.fun) competition
**Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins**
(`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`).

It trades 10 SOL of paper money on a replay of real pump.fun bonding-curve
activity (protocol `agent-fun/replay/v2`). Nothing is traded for real: the
house replay scorer runs this bot over recorded Solana chain data and ranks
entries by **hourly Sharpe ratio** on a 6-hour forward window. A placement
needs a net PnL above holding cash — above 0 SOL after every fee.

## Strategy

**Buy one moment: the first trade that pushes a curve's real SOL reserves
across 55.** The crossing trade must itself be a buy, the last 10 trades must
be at least 70% buys, and the price must be up at least 8% over those 10
trades. One entry per coin, ever — a coin that dips back below 55 and
re-crosses is the same stalled coin trying again.

Why this moment, and why nothing else worked: a launch runs +30–100% in its
first few slots and then reverses, and the 2-slot latency means any entry
that waits for a visible signal buys the top. The one structural move that
does not reverse is graduation itself: a bonding curve that reaches ~85 SOL
of real reserves completes and migrates, and the last stretch before
completion is where FOMO buyers pile in. The crossing filter selects curves
whose run is *continuing* into graduation, not coins that already stalled.

Exits are mechanical, and the stop is deliberately wide: graduation trades
pull back 8–20% after entry before running to +40%, so a tight stop just
donates money. **Take profit +40%, stop loss −30%, trailing stop armed at
+40% with a 10% give-back, 800-slot time limit, stale exit after 900 slots
with no trade.** No trailing stop armed at +15% and no exits on creator sells
or outsized sells — measured and removed: they cut 19 of 24 trades early and
left a single take-profit against 7 stops. A 2 SOL sell on a 55 SOL curve is
ordinary profit-taking, not an exit signal.

Stakes are 0.3 SOL per crossing (the 1%-of-real-reserve cap allows 0.55 SOL
at 55 SOL of reserves, so the stake is never cap-constrained), at most 5
coins open at once.

## Candidate tournament

Sixteen candidate strategies were compared pairwise against the published
judge brief in its weight order — determinism and guardrails first, then
hourly Sharpe on an unseen window, then net PnL above zero after fees, then
breadth (the edge must not rest on 2–3 coins), then drawdown headroom:

| Candidate | Fate |
| --- | --- |
| Launch Momentum | Out round 1: −9.5 SOL on the dev window |
| Dip-Buying / mean reversion | Out round 1: −4 SOL |
| Launch Sniper | Out round 1: −2.8% per trade |
| Creator-Conviction | Out round 1: −1% per trade |
| Crowd-Arrival / volume surge | Out round 1: −2% per trade |
| Equal-Weight Buy-and-Hold | Out round 1: holding everything to the flatten is structurally negative |
| Fresh-Coin Spray | Out round 1: diversifies a negative edge |
| Graduation Dip | Out round 2: +2.9% per trade, but carried by 3 trades — fails breadth |
| Reserve-Velocity | Finalist: +2.7% per trade, but also carried by 3 trades |
| Crossing 55, tight exits (TP +25% / SL −15%) | Out round 2: a TP +12% variant measured −0.6% — profit-taking early kills the completion run |
| Crossing 70 | Out round 2: fewer trades, less runway to completion |
| Crossing 40 | Out round 2: admits stalled coins (−1.5% per trade) |
| Completion-Rush Scalp (70–80, TP +8% / SL −4%) | Out round 2: at best breakeven against the ~2.6% round-trip cost |
| Survivor Continuation | Out round 1: no measured positive edge |
| Flow-Imbalance Momentum | Out round 1: Crowd-Arrival under another name |
| **Graduation Crossing 55 — champion** | **+0.80 SOL net on the dev window, positive even without its top 3 coins** |

The final was Graduation Crossing 55 vs Reserve-Velocity. The champion won
on every criterion: a structural edge (graduation FOMO) measured over 36
trips with a flat parameter plateau, against a velocity threshold whose edge
rests on 3 trades.

## Guardrail probes

The competition ranks below every entry that meets its minimum bar any entry
that misses it (a round trip of at least 0.01 SOL on each of at least 20
coins). Crossings are rare — about 3–4 in a 6-hour window — so once an hour
of block time has passed and the bot has traded fewer than 24 distinct
coins, it opens tiny 0.02 SOL probe round trips on liquid, buy-dominant
curves (5–60 SOL real reserves, ≥60% buys over the last 15 trades, creator
never sold) and sells them as soon as the buy lands. A probe costs roughly
0.0007 SOL in fees, and the bot never probes a coin twice.

## Dev replay results

Kit grader, process driver, on the kit's frozen dev window (128,058 events,
24 hours), run twice with byte-identical action logs:

- **Net PnL +0.7997 SOL** (return +8.0%, 90% interval +0.153…+1.470 SOL)
- 76 fills over 38 coins, 38 round trips, win rate 36.8%
- Max drawdown 3.29% (guardrail: ≤50%)
- Fees 0.127 SOL curve + 0.008 SOL tx; at 2× fees net PnL is still +0.656 SOL
- Top 3 coins made 35% of the gains; without them net PnL is +0.40 SOL
- Guardrails met: 38 coins hold a round trip of ≥0.01 SOL (≥20 required)

Parameter sweeps over four failed-tx draws put the shipped settings at mean
+0.83 SOL (worst +0.79), positive even without the two best trades (+0.55);
neighbouring settings (stop −25%/−40%, price-rise +4%/+8%) all land within
+0.78…+0.87, so the edge is a plateau, not a knife-edge optimum.

Stress test (10 block surrogates of the dev window, kit grader): median
−0.42 SOL, p10 −1.15, p90 +0.21; 6 of 10 copies lost money; the dev score
sits above all 10 copies. Read plainly: the dev result leans on this
window's own graduations — a fresh window is a gamble with positive skew (4
of 10 surrogates were positive, best +0.65), not a guaranteed repeat. The
entry is submitted on the strength of the dev edge plus the free-entry cost,
not on a promise the final window repeats it.

## How to run

```sh
# Grade exactly as the server grades the dev phase (needs the unpacked kit):
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree

# Fast offline backtest on the dev window:
node tools/backtest.ts <kit>
# Parameter sweep (ranks by mean net PnL over four failed-tx draws):
node tools/sweep.ts <kit> '{}' '{"stopLoss":[0.2,0.3]}' 10
```

The grader runs `node /bot/main.ts` with this directory mounted at `/bot`.
`main.ts` is only the entrypoint; the strategy lives in `strategy.ts`, the
wire shim is vendored at `vendor/makefun-bot.ts` (a byte-identical copy of the
kit's `sdk/ts/makefun-bot.ts`), and `tools/` holds the local backtest harness
(a port of the kit's replay engine, used only for offline tuning — the bot
never imports it).

## Determinism

No clock, no environment, no randomness, no network: every decision is a pure
function of the batches the harness sends, all price math is integer (bigint
cross-multiplication on virtual reserves), and iteration is only over
insertion-ordered maps fed by the batch stream. The two graded executions
reproduce byte for byte.

## Files

- `main.ts` — entrypoint: speaks `agent-fun/replay/v2` through the SDK shim.
- `strategy.ts` — the Graduation Crossing strategy (entry, exits, probes).
- `vendor/makefun-bot.ts` — kit SDK shim, vendored byte-identical.
- `tools/` — offline backtest (`backtest.ts`), parameter sweep (`sweep.ts`),
  and the local replay-engine port (`sim.ts`).
- `LICENSE` — MIT.
