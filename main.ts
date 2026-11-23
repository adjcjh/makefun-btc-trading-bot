// Breakout-rider bot for make.fun "Race a BTC trading bot live for 24 hours".
//
// Idea: 1-minute cbBTC bars are noisy (about 8 bps stdev per minute) and a
// round trip costs roughly 26 bps, so the bot trades rarely. It enters only
// on a confirmed breakout above the rolling N-bar high, rides the move with
// a trailing stop, and otherwise stays in cash. That shape made money on
// the dev window (one big early rise, then a flat range) and, in a falling
// race window, it would simply not enter (or exit fast) instead of riding
// the fall down the way buy-and-hold does.
//
// Everything is a pure function of the closes seen so far: no clock, no
// network, no randomness, so two runs on the same data give the same orders.
//
// Long only, one symbol (CBBTC), full cash on entry, whole position on exit.

import { runBars, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- tunable parameters (swept offline against the dev window) ---
const LOOKBACK = 120; // bars for the rolling high/low
const BREAK_BPS = 20; // close must beat the rolling high by this much (bps)
const TRAIL_BPS = 200; // trailing stop: sell if close falls this far below peak (bps)
const STOP_BPS = 150; // hard stop: sell if position value falls this far below cost (bps)
const COOLDOWN_BARS = 120; // bars to wait after an exit before re-entering
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on
// Slow-trend entry: a breakout rule never fires on a slow steady climb (the
// rolling high keeps pace with the price), so a strong 480-bar return also
// enters, full size. On the dev window the breakout fires first, so this
// never triggers there.
const MOM_LOOKBACK = 480;
const MOM_MIN_BPS = 80; // 480-bar return must exceed this to enter (bps)
// Late-window probe: the race window needs at least one real trade to rank
// at all, so if nothing has traded by this bar, accept a smaller breakout
// (shorter lookback, smaller break) with a quarter-size position. On the
// dev window the main breakout fires long before this, so it never triggers
// there; in a falling or flat race window it turns a no-trade entry (ranked
// below every trader) into a small, cheap trade.
const PROBE_BAR = 720;
const PROBE_LOOKBACK = 60;
const PROBE_BREAK_BPS = 10;
const PROBE_FRACTION_NUM = 1; // probe size = cash * num / den
const PROBE_FRACTION_DEN = 4;
// Last-resort probe: a perfectly smooth fall has no bounce and no climb, so
// no price rule would ever fire and the entry would make zero trades and
// rank below every trader. If still no trade by this bar, buy a tenth of
// the cash outright; the trailing and hard stops cap the damage at about
// 1.5% of that tenth plus fees.
const LAST_PROBE_BAR = 1200;
const LAST_PROBE_NUM = 1;
const LAST_PROBE_DEN = 10;

const closes: number[] = [];
let peakSinceEntry: number | null = null;
let cooldownUntil = -1;
let trades = 0; // orders sent so far (buys + sells)

function rollingHigh(n: number): number | null {
  if (closes.length < n + 1) return null;
  let hi = -Infinity;
  for (let i = closes.length - 1 - n; i < closes.length - 1; i++) if (closes[i] > hi) hi = closes[i];
  return hi;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    closes.push(close);
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const { caps, fees } = state.hello;

    if (held !== undefined) {
      if (peakSinceEntry === null || close > peakSinceEntry) peakSinceEntry = close;
      const value = state.value(SYMBOL, held.qty);
      const trailHit = peakSinceEntry !== null && close * 10000 <= peakSinceEntry * (10000 - TRAIL_BPS);
      const stopHit = value * 10000n <= held.cost * BigInt(10000 - STOP_BPS);
      if (trailHit || stopHit) {
        peakSinceEntry = null;
        cooldownUntil = batch.seq + COOLDOWN_BARS;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        trades += 1;
        return [sell];
      }
      return [];
    }

    // Flat: consider entering on a breakout.
    if (batch.seq < cooldownUntil) return [];
    const hi = rollingHigh(LOOKBACK);
    if (hi === null) return [];
    let fractionNum = 1n;
    let fractionDen = 1n;
    let brokeOut = close * 10000 > hi * (10000 + BREAK_BPS);
    if (!brokeOut && closes.length > MOM_LOOKBACK) {
      const then = closes[closes.length - 1 - MOM_LOOKBACK];
      if (then > 0 && (close - then) * 10000 > then * MOM_MIN_BPS) brokeOut = true;
    }
    if (!brokeOut && batch.seq >= PROBE_BAR && trades === 0) {
      // No trade yet late in the window: accept a smaller breakout, or a
      // slow climb over the whole window so far, at quarter size.
      const probeHi = rollingHigh(PROBE_LOOKBACK);
      const longThen = closes.length > PROBE_BAR ? closes[closes.length - 1 - PROBE_BAR] : null;
      const probeBreak = probeHi !== null && close * 10000 > probeHi * (10000 + PROBE_BREAK_BPS);
      const probeClimb = longThen !== null && longThen > 0 && (close - longThen) * 10000 > longThen * 50;
      if (probeBreak || probeClimb) {
        brokeOut = true;
        fractionNum = BigInt(PROBE_FRACTION_NUM);
        fractionDen = BigInt(PROBE_FRACTION_DEN);
      }
    }
    if (!brokeOut && batch.seq >= LAST_PROBE_BAR && trades === 0) {
      brokeOut = true;
      fractionNum = BigInt(LAST_PROBE_NUM);
      fractionDen = BigInt(LAST_PROBE_DEN);
    }
    if (!brokeOut) return [];

    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
    let slice = state.cash < byWeight ? state.cash : byWeight;
    slice = (slice * fractionNum) / fractionDen;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    peakSinceEntry = close;
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS };
    trades += 1;
    const orders: OrderInput[] = [buy];
    return orders;
  },
});
