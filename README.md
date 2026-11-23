# btc-breakout-rider

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/{owner}/{repo}/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/{owner}/{repo}/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A breakout-rider bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain prices, long only, with $1,000 of paper money.

## Strategy

One-minute bars are noisy (about 8 bps stdev) and a round trip costs roughly 26 bps in fees, slippage and price impact, so the bot trades rarely and only on confirmed trend:

- **Breakout entry:** buys full size when the close beats the rolling 120-bar high by 20 bps.
- **Slow-trend entry:** also buys when the 480-bar return exceeds 80 bps, for slow steady climbs where the rolling high keeps pace with the price and a breakout never fires.
- **Trailing stop:** sells the whole position if the close falls 200 bps below the peak since entry; a hard stop sells if the position value falls 150 bps below cost.
- **Cooldown:** 120 bars after an exit before re-entering, so a whipsaw cannot make it re-enter on the next bar.
- **Late-window probes:** the race window needs at least one real trade to rank at all, so if nothing has traded by bar 720 the bot accepts a smaller breakout (60-bar high + 10 bps, or a 50 bps climb over the window) at quarter size, and if still nothing by bar 1200 it buys a tenth of the cash outright. The stops cap the damage on a probe to about 1.5% of that tenth plus fees.

Everything is a pure function of the closes seen so far: no clock, no network, no randomness, so two runs on the same data produce identical orders.

## Run it

```sh
node /bot/main.ts
```

The bot speaks `agent-fun/bars-replay/v1` over stdin/stdout (see `vendor/makefun-bars.ts`, the kit's SDK shim).

## Local dev grade

Graded with the official kit's local grader (`node cli/makefun.mjs grade-local --kit . --bot . --driver process`):

- **Dev net PnL: +$26.84** (gate is > $0) — 1 trade, max drawdown 1.98%, fees $0.81
- **Determinism:** two runs produce byte-identical action logs (`1e1d8ca6a2fa…`)
- Baselines on the same dev window for comparison: buy-and-hold +$32.17, momentum +$34.94, hold-cash $0, ema-cross −$114.83 (76 trades), rsi-bollinger −$9.32, adx-momentum −$11.20

Scenario checks with a local replica of the same rules (approximate fills): mirrored falling window −$20.92 (vs −$36 for buy-and-hold), steady +3% climb +$18.54, steady −3% fall −$0.63 with 1 trade, rise-then-crash +$17.70, flat range +$22.29, choppy ±1.5% sine −$22.35.

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
