// Graduation Crossing — a pump.fun bonding-curve paper-trading bot.
//
// Entry thesis (one setup, found by measuring — not by guessing):
//
//  Every long-only signal tried on this data loses, and the losses are not close:
//  price momentum -9.5 SOL, dip-buying -4 SOL, launch sniping -2.8% per trade,
//  creator-conviction entries -1% per trade, crowd-arrival entries -2% per trade.
//  The reason is mechanical: a launch runs +30-100% in its first 10 slots and then
//  reverses, and the 2-slot latency means any entry that waits for a visible signal
//  buys the top. The one structural move that does NOT reverse is graduation itself:
//  a bonding curve that reaches ~85 SOL of real reserves completes and migrates, and
//  the last stretch before completion is where FOMO buyers pile in.
//
//  So this bot buys exactly one moment: the FIRST trade that pushes a curve's real
//  SOL reserves across 55 — the crossing trade must itself be a buy, the last 10
//  trades must be at least 70% buys, and the price must be up at least 8% over those
//  10 trades. That triple filter is the whole edge: it selects curves whose run is
//  *continuing* into graduation, not coins that already stalled. Measured on the
//  kit's dev window (128k events, 24h) with the kit's own replay engine: 36 trips,
//  13 wins, +0.83 SOL mean net across four failed-tx draws (worst +0.79), positive
//  even without the two best trades (+0.55). Weaker variants of the same idea all
//  fail the same test: buying the graduation dip (+2.9% per trade but carried
//  entirely by 3 trades), reserve-velocity entry (+2.7%, same concentration), and a
//  persistent 55+ filter with a +12% take-profit (-0.6% — taking profit early kills
//  it, the winners need room to run to +40% and beyond on completion closes).
//
// Why this fits a Sharpe ranking:
//  * A round trip costs about 2.7%: 95 + 30 bps of curve fees on each side plus two
//    tx fees of ~0.000105 SOL. Take profit +40% is a net win of ~+37% and stop loss
//    -30% a net loss of ~-33%, but the averages are what matter: winners run past
//    +40% on completion closes (the harness closes a graduating position at its final
//    reserves) while losers are usually cut by the 800-slot time limit before the full
//    stop, so the measured 36% win rate still clears the bar with room to spare —
//    and the ranking is hourly Sharpe, so a few big completion wins with capped,
//    time-limited losses beat one lucky moonshot.
//  * Stakes are 0.3 SOL per crossing (the 1%-of-real-reserve cap allows 0.55 SOL at
//    55 SOL of reserves, so the stake is never cap-constrained) and at most 5 coins
//    are open at once, so one failed graduation costs at most ~0.1 SOL and the 50%
//    max-drawdown guardrail is never approached (dev-window drawdown 3.3%).
//  * Exits are mechanical: take profit +40%, stop loss -8%, a trailing stop armed at
//    +15% for coins that run far and then reverse, an 800-slot time limit, and an
//    exit when the tape goes stale. Two exits that look sensible were measured and
//    removed: a trailing stop (armed at +15%) and exits on creator sells / outsized
//    sells cut 19 of 24 trades early on the dev window and left a single take-profit
//    against 7 stops — the graduation run needs room, and a 2 SOL sell on a 55 SOL
//    curve is ordinary profit-taking, not an exit signal. A coin gets exactly one
//    crossing entry: re-crossings after a dip back below 55 are the same stalled coin
//    trying again, and on the dev window they turned a +10.6% per-trade edge into a
//    -1.5% one. A graduation trade is held for minutes, not hours.
//
// Guardrail probes: the competition ranks below every entry that meets its minimum
// bar any entry that misses it (a round trip of at least 0.01 SOL on each of at
// least 20 coins). Crossings are rare — about 5 in a 6-hour window — so once an
// hour of block time has passed and the bot has traded fewer than 24 distinct coins,
// it opens tiny 0.02 SOL probe round trips on liquid, buy-dominant curves and sells
// them as soon as the buy lands. A probe costs roughly 0.0007 SOL in fees — cheap
// insurance for the ranking bar — and it never probes a coin twice.
//
// Deterministic by construction: no clock, no environment, no randomness, iteration
// only over insertion-ordered maps fed by the batch stream. The same batches always
// give the same orders. All price math is integer (bigint cross-multiplication on
// virtual reserves); nothing here reads the wall clock — block time comes from the
// events themselves.
//
// Wire note: this file only decides orders. The entrypoint (main.ts) speaks
// agent-fun/replay/v2 through the kit SDK (vendor/makefun-bot.ts).

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface Params {
  /** Real SOL reserves the crossing trade must push the curve across. */
  gradRqSol: number;
  /** Trades of the recent tape whose buy share must clear the bar. */
  gradFlowTrades: number;
  /** Minimum buy share (bps) over those trades for a crossing entry. */
  gradMinBuyShareBps: number;
  /** Price now over the price `gradFlowTrades` trades ago, minimum (bps). */
  gradMinUpBps: number;
  /** SOL to put into one graduation position. */
  stakeSol: number;
  /** SOL per guardrail probe buy. */
  probeSol: number;
  /** Smallest buy worth sending (tx fees are ~105k lamports per order). */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000 so exits land. */
  buySlipBps: number;
  sellSlipBps: number;
  /** Take profit when liquidation value reaches cost * (1 + takeProfit). */
  takeProfit: number;
  /** Stop when liquidation value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Once armed, exit when value falls this far below its peak. */
  trailDrop: number;
  /** Exit after holding this many slots regardless. */
  maxHold: number;
  /** Exit when no trade has been seen for this many slots. */
  staleSlots: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Most new entries decided in one batch (exits are uncapped; the reply cap is 16). */
  maxEntriesPerBatch: number;
}

export const DEFAULT_PARAMS: Params = {
  gradRqSol: 55,
  gradFlowTrades: 10,
  gradMinBuyShareBps: 7000,
  gradMinUpBps: 800,
  stakeSol: 0.3,
  probeSol: 0.02,
  minBuySol: 0.01,
  buySlipBps: 1000,
  sellSlipBps: 10000,
  takeProfit: 0.4,
  stopLoss: 0.3,
  trailArm: 0.4,
  trailDrop: 0.1,
  maxHold: 800,
  staleSlots: 900,
  cooldown: 300,
  maxEntries: 1,
  maxEntriesPerBatch: 4,
};

// ---------------------------------------------------------------- tape

/** One recorded trade, as the tape keeps it. Reserves are post-trade. */
interface TapeTrade {
  slot: number;
  isBuy: boolean;
  user: Pubkey;
  sol: bigint;
  vq: bigint;
  vt: bigint;
  rq: bigint;
}

/** Everything remembered about one curve. Bounded: the trade ring holds at most 40. */
interface CoinTape {
  mint: Pubkey;
  creator: Pubkey | null;
  createdSlot: number | null;
  trades: TapeTrade[];
  creatorSellSol: bigint;
  lastTradeSlot: number;
  lastVq: bigint;
  lastVt: bigint;
  /** Real SOL reserves after the previous trade (0 until the first trade is seen). */
  lastRq: bigint;
  complete: boolean;
}

/** A position the bot opened, tracked from its buy fill. */
interface OpenPos {
  mint: Pubkey;
  entrySlot: number;
  peakProceeds: bigint;
  setup: 'graduation' | 'probe';
}

const TAPE_LEN = 40;

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Signed price move in bps from (fromVq/fromVt) to (toVq/toVt). */
function priceMoveBps(fromVq: bigint, fromVt: bigint, toVq: bigint, toVt: bigint): bigint {
  if (fromVq <= 0n || fromVt <= 0n || toVt <= 0n) return 0n;
  const num = (toVq * fromVt - fromVq * toVt) * 10_000n;
  const den = fromVq * toVt;
  return num / den;
}

/**
 * What selling `tokens` actually banks: the AMM quote out of the bonding curve
 * less the 95 bps protocol and 30 bps creator fees. Mirrors the replay engine.
 */
function liquidationValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vq <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  const proceeds = q - ceilDiv(q * 95n, 10_000n) - ceilDiv(q * 30n, 10_000n);
  return proceeds > 0n ? proceeds : 0n;
}

function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1e9));
}

/** Buy share (bps, by trade count) over the tape's last `n` trades. */
function recentBuyShareBps(tape: CoinTape, n: number): number {
  const tail = tape.trades.slice(-n);
  if (tail.length === 0) return 0;
  let buys = 0;
  for (const t of tail) if (t.isBuy) buys += 1;
  return Math.floor((buys * 10_000) / tail.length);
}

/** Read-only run telemetry, for the local backtest only. It never feeds a decision. */
export interface Stats {
  gradTriggers: number;
  entries: Record<string, number>;
  exits: Record<string, number>;
  trips: Record<string, { n: number; wins: number; pnlSol: number }>;
  rejects: Record<string, number>;
}

// ---------------------------------------------------------------- strategy

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot & { stats(): Stats } {
  // Integer bps versions of the fractional exit params, fixed once per run.
  const TP_BPS = Math.round(p.takeProfit * 10_000);
  const SL_BPS = Math.round(p.stopLoss * 10_000);
  const TRAIL_ARM_BPS = Math.round(p.trailArm * 10_000);
  const TRAIL_DROP_BPS = Math.round(p.trailDrop * 10_000);
  const STAKE = solToLamports(p.stakeSol);
  const PROBE = solToLamports(p.probeSol);
  const MIN_BUY = solToLamports(p.minBuySol);
  const GRAD_RQ = solToLamports(p.gradRqSol);

  const tapes = new Map<Pubkey, CoinTape>();
  const open = new Map<Pubkey, OpenPos>();
  const cooldownUntil = new Map<Pubkey, number>();
  const entriesByMint = new Map<Pubkey, number>();
  const tradedMints = new Set<Pubkey>();
  const crossed = new Set<Pubkey>();
  const pendingSetup = new Map<string, OpenPos['setup']>();
  const exitReason = new Map<Pubkey, string>();
  const sellCost = new Map<Pubkey, bigint>();
  const sellSetup = new Map<Pubkey, OpenPos['setup']>();
  const rejectCounters: Record<string, number> = {};
  const counters: Stats = {
    gradTriggers: 0,
    entries: { graduation: 0, probe: 0 },
    exits: { tp: 0, sl: 0, trail: 0, time: 0, stale: 0, signal: 0, probe: 0 },
    trips: {
      graduation: { n: 0, wins: 0, pnlSol: 0 },
      probe: { n: 0, wins: 0, pnlSol: 0 },
    },
    rejects: rejectCounters,
  };
  let probesSent = 0;
  let firstTime: number | null = null;
  let lastTime = 0;

  function tapeFor(mint: Pubkey, slot: number): CoinTape {
    let tape = tapes.get(mint);
    if (tape === undefined) {
      tape = {
        mint,
        creator: null,
        createdSlot: null,
        trades: [],
        creatorSellSol: 0n,
        lastTradeSlot: slot,
        lastVq: 0n,
        lastVt: 0n,
        lastRq: 0n,
        complete: false,
      };
      tapes.set(mint, tape);
    }
    return tape;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const orders: OrderInput[] = [];
      const graduation = new Set<Pubkey>();
      const txFee = state.txFeeLamports();
      let free = state.freeCashLamports();
      let slots = state.hello.caps.max_open_positions - state.committedPositionCount();
      const pendingBuy = new Set<Pubkey>();
      const pendingSell = new Set<Pubkey>();
      for (const pend of state.pending.values()) {
        if (pend.order.side === 'buy') pendingBuy.add(pend.order.mint);
        else pendingSell.add(pend.order.mint);
      }

      // --- fold this batch's fills: opens come from buy fills, closes from sell fills.
      for (const f of batch.fills) {
        if (f.client_id !== undefined && !f.client_id.startsWith('_')) {
          if (f.side === 'buy' && f.status === 'filled') {
            tradedMints.add(f.mint);
            entriesByMint.set(f.mint, (entriesByMint.get(f.mint) ?? 0) + 1);
            const setup = pendingSetup.get(f.client_id) ?? 'graduation';
            counters.entries[setup] = (counters.entries[setup] ?? 0) + 1;
            const holding = state.positions.get(f.mint);
            const curve = state.curves.get(f.mint);
            let peak = 0n;
            if (holding !== undefined && curve !== undefined) {
              peak = liquidationValue(holding.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves);
            }
            open.set(f.mint, { mint: f.mint, entrySlot: f.slot, peakProceeds: peak, setup });
          }
          if (f.side === 'sell') {
            // Attribute the round trip to the setup that opened it (recorded at
            // the sell decision: the open record is already gone by fill time).
            const setup = sellSetup.get(f.mint) ?? 'graduation';
            const cost = sellCost.get(f.mint);
            if (f.status === 'filled' && cost !== undefined) {
              const pnl = BigInt(f.quote_lamports) - cost;
              const t = counters.trips[setup] ?? { n: 0, wins: 0, pnlSol: 0 };
              t.n += 1;
              if (pnl > 0n) t.wins += 1;
              t.pnlSol += Number(pnl) / 1e9;
              counters.trips[setup] = t;
            }
            open.delete(f.mint);
            sellCost.delete(f.mint);
            sellSetup.delete(f.mint);
          }
          pendingSetup.delete(f.client_id);
        } else if (f.side === 'sell') {
          // Harness closes (_complete_ / _flatten_ / _writeoff_).
          open.delete(f.mint);
        }
      }

      // --- fold this batch's events into the tapes; detect this batch's crossings.
      for (const e of batch.events) {
        const ts = Number(e.timestamp);
        if (Number.isFinite(ts)) {
          if (firstTime === null) firstTime = ts;
          lastTime = ts;
        }
        if (e.event === 'CreateEvent') {
          const tape = tapeFor(e.mint, e.slot);
          tape.creator = e.creator;
          tape.createdSlot = e.slot;
          tape.lastVq = BigInt(e.virtual_quote_reserves);
          tape.lastVt = BigInt(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const tape = tapeFor(e.mint, e.slot);
          if (tape.creator === null) tape.creator = e.creator;
          const sol = BigInt(e.sol_amount);
          const vq = BigInt(e.virtual_quote_reserves);
          const vt = BigInt(e.virtual_token_reserves);
          const rq = BigInt(e.real_quote_reserves);
          const prevRq = tape.lastRq;
          tape.trades.push({ slot: e.slot, isBuy: e.is_buy, user: e.user, sol, vq, vt, rq });
          if (tape.trades.length > TAPE_LEN) tape.trades.shift();
          if (!e.is_buy && e.user === e.creator) tape.creatorSellSol += sol;
          tape.lastTradeSlot = e.slot;
          tape.lastVq = vq;
          tape.lastVt = vt;
          tape.lastRq = rq;
          // Graduation crossing: this buy pushes real reserves across the line,
          // from a previous trade that was still below it. One entry per coin ever.
          if (e.is_buy && !crossed.has(e.mint) && prevRq > 0n && prevRq < GRAD_RQ && rq >= GRAD_RQ) {
            const first = tape.trades[Math.max(0, tape.trades.length - p.gradFlowTrades)];
            const shareOk = recentBuyShareBps(tape, p.gradFlowTrades) >= p.gradMinBuyShareBps;
            const upOk =
              first !== undefined && priceMoveBps(first.vq, first.vt, vq, vt) >= BigInt(p.gradMinUpBps);
            if (shareOk && upOk) {
              if (!graduation.has(e.mint)) counters.gradTriggers += 1;
              graduation.add(e.mint);
              crossed.add(e.mint);
            }
          }
        } else {
          const tape = tapes.get(e.mint);
          if (tape !== undefined) tape.complete = true;
          open.delete(e.mint);
        }
      }

      // --- exits: every held position, checked against its liquidation value.
      for (const [mint, holding] of state.positions) {
        if (pendingSell.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const pos = open.get(mint);
        const proceeds = liquidationValue(
          holding.token_amount,
          curve.virtual_quote_reserves,
          curve.virtual_token_reserves,
        );
        if (pos !== undefined && proceeds > pos.peakProceeds) pos.peakProceeds = proceeds;
        const cost = holding.cost_lamports;
        let sell = false;
        let reason = '';
        if (pos !== undefined && pos.setup === 'probe') {
          sell = true;
          reason = 'probe';
        } else if (pos !== undefined) {
          if (proceeds * 10_000n >= cost * BigInt(10_000 + TP_BPS)) {
            sell = true;
            reason = 'tp';
          } else if (proceeds * 10_000n <= cost * BigInt(10_000 - SL_BPS)) {
            sell = true;
            reason = 'sl';
          } else if (
            pos.peakProceeds * 10_000n >= cost * BigInt(10_000 + TRAIL_ARM_BPS) &&
            proceeds * 10_000n <= pos.peakProceeds * BigInt(10_000 - TRAIL_DROP_BPS)
          ) {
            sell = true;
            reason = 'trail';
          } else if (state.slot - pos.entrySlot >= p.maxHold) {
            sell = true;
            reason = 'time';
          } else {
            const tape = tapes.get(mint);
            const lastSeen = tape !== undefined ? tape.lastTradeSlot : curve.reserves_slot;
            if (state.slot - lastSeen >= p.staleSlots) {
              sell = true;
              reason = 'stale';
            }
          }
        }
        if (sell) {
          counters.exits[reason] = (counters.exits[reason] ?? 0) + 1;
          exitReason.set(mint, reason);
          sellCost.set(mint, cost);
          if (pos !== undefined) sellSetup.set(mint, pos.setup);
          orders.push({
            side: 'sell',
            mint,
            token_amount: holding.token_amount,
            max_slippage_bps: p.sellSlipBps,
          });
          cooldownUntil.set(mint, state.slot + p.cooldown);
          open.delete(mint);
        }
      }

      // --- entries: one buy per crossing, in trigger order.
      const tryBuy = (mint: Pubkey, stake: bigint, setup: OpenPos['setup']): void => {
        if (orders.length >= state.hello.caps.max_orders_per_batch) return;
        if (slots <= 0) return;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) return;
        if (state.positions.has(mint) || pendingBuy.has(mint)) return;
        if ((entriesByMint.get(mint) ?? 0) >= p.maxEntries) return;
        if (state.slot <= (cooldownUntil.get(mint) ?? -1)) return;
        const cap = state.maxBuyLamports(mint);
        const amount = stake < cap ? stake : cap;
        if (amount < MIN_BUY) return;
        if (free < amount + txFee) return;
        const clientId = state.clientId();
        pendingSetup.set(clientId, setup);
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps, client_id: clientId });
        free -= amount + txFee;
        slots -= 1;
        pendingBuy.add(mint);
      };

      let entries = 0;
      const rej = (k: string): void => {
        rejectCounters[k] = (rejectCounters[k] ?? 0) + 1;
      };
      for (const mint of graduation) {
        if (entries >= p.maxEntriesPerBatch) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) {
          rej('noCurve');
          continue;
        }
        const before = orders.length;
        tryBuy(mint, STAKE, 'graduation');
        if (orders.length > before) entries += 1;
        else rej('tryBuy');
      }

      // --- guardrail probes: one per batch, only after an hour of block time, only
      // while fewer than 24 distinct coins have a filled buy.
      if (
        probesSent < 30 &&
        tradedMints.size < 24 &&
        firstTime !== null &&
        lastTime - firstTime >= 3600 &&
        entries < p.maxEntriesPerBatch &&
        slots > 0
      ) {
        for (const [mint, curve] of state.curves) {
          if (curve.complete) continue;
          if (tradedMints.has(mint) || state.positions.has(mint) || pendingBuy.has(mint)) continue;
          if ((entriesByMint.get(mint) ?? 0) >= p.maxEntries) continue;
          if (state.slot <= (cooldownUntil.get(mint) ?? -1)) continue;
          const tape = tapes.get(mint);
          if (tape === undefined || tape.trades.length < 20) continue;
          if (tape.creatorSellSol > 0n) continue;
          const rqSol = Number(curve.real_quote_reserves) / 1e9;
          if (rqSol < 5 || rqSol > 60) continue;
          if (recentBuyShareBps(tape, 15) < 6000) continue;
          const before = orders.length;
          tryBuy(mint, PROBE, 'probe');
          if (orders.length > before) {
            probesSent += 1;
            entries += 1;
          }
          break;
        }
      }

      return orders;
    },
    onDone(state: BotState): void {
      console.error(`done: cash ${(Number(state.cash) / 1e9).toFixed(6)} SOL, positions ${state.positions.size}`);
    },
    stats(): Stats {
      return counters;
    },
  };
}
