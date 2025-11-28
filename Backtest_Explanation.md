
# Backtest Logic — Human‑Readable Explanation  
_(backtest.ts)_

This document explains how the **backtest engine** operates in your portfolio optimizer.

---

# 1. Purpose of the Backtest Engine

The backtest simulates:

- **Portfolio value through time**
- **Quarterly rebalancing**
- **Performance metrics**  
- **Rebalance event history**

It does **not** compute risk‑based weights — it *calls* the ERC or ES optimizer to get weights.

---

# 2. Data Preparation

The backtest receives:

- price history  
- dividend history (optional toggle)  
- rebalancing schedule (quarterly)  
- selected model (ERC or ES)  
- lookback window (1y, 3y, 5y)  
- burn‑in period (strict mode)

A “burn‑in” ensures the **first displayed point** has a full lookback window *before* it.

---

# 3. Daily Portfolio Update

For each trading day:
1. Update portfolio value  
2. Adjust cash + holdings for:
   - price changes  
   - optional dividend reinvestments  
3. Track weights through drift

---

# 4. Rebalancing Logic

On each quarter boundary (March, June, September, December):

```
if shouldRebalance(date):
    - extract lookback window  
    - run ERC or ES optimizer  
    - compute target weights  
    - convert target weights -> target dollar amounts  
    - compute trades required  
    - apply transaction costs  
    - update holdings  
    - record a rebalance event  
```

Backtest **never changes the starting portfolio size** — it only redistributes capital.

---

# 5. Rebalance Event Recording

Each rebalance event logs:

- timestamp  
- target weights  
- trade list (per asset)  
- trade dollar volume  
- transaction costs  
- portfolio value after rebalance  

These are returned as:
```
results.analytics.backtest.rebalanceEvents
results.analytics.backtest.rebalanceDates
```

This powers:
- your timeline  
- your UI rebalancing table  
- backtest summary

---

# 6. Metrics Computed

- CAGR  
- volatility  
- Sharpe  
- max drawdown  
- turnover  
- total transaction cost  
- number of rebalances  

---

# 7. Scaling and Normalization

Final values are scaled so:
```
initial_portfolio_value = 10,000
```

Trade amounts, volumes, and costs are scaled proportionally.

---

# 8. What Backtest Is NOT

It is **not** a risk model.  
It simply:

1. Requests optimizer output  
2. Applies trades  
3. Tracks value  
4. Produces metrics + events  

The risk models live in:
- `riskBudgeting.ts`
- `optimizerES.ts`

---

End.
