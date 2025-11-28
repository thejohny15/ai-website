
# Rebalancing + route.ts — How the API Works  
_(Human‑Readable Documentation)_

This explains how the backend endpoint (`route.ts`) connects:

- the optimizers  
- the backtest  
- the frontend  
- the rebalancing system  

---

# 1. Purpose of `route.ts`

`route.ts` is the **brain of the API endpoint** `/api/risk-budgeting`.

It receives a request with:

- tickers  
- lookback  
- model (ERC or ES)  
- budgetStrength / riskBudgetStrength  
- dividends on/off  
- burn‑in mode  
- backtest toggle  

It orchestrates everything and returns one clean JSON response.

---

# 2. What route.ts Does (Step by Step)

### Step 1 — Parse Request  
Extract:
- tickers  
- model (erc / es)  
- lookback  
- dates  
- weights mode  
- budgets  
- risk parameters  

### Step 2 — Load Historical Data  
From your local DB:
- adjusted close  
- dividends (optional)

### Step 3 — Compute Weights “Today”  
For dashboard display:
- call `riskBudgeting.ts` (ERC)  
- or `optimizerES.ts` (ES)  

Returned:
- weights  
- risk contributions  
- risk contribution shares  
- diagnostics  

### Step 4 — Run Backtest  
If user requested backtest:
```
backtestResults = runBacktest({
    prices,
    dividends,
    model,
    lookback,
    budgetStrength,
    burnin,
    ...
})
```

Backtest returns:
- daily portfolio value  
- quarterly rebalance events  
- metrics  
- rebalance dates  

### Step 5 — Build Response JSON

`route.ts` returns:

```
{
  weights,
  riskContributions,
  riskContributionShares,
  analytics: {
     backtest: {
        dates,
        values,
        rebalanceEvents,
        rebalanceDates,
        metrics
     }
  }
}
```

This is the exact shape the frontend expects.

---

# 3. How Rebalancing Is Integrated

Rebalancing is triggered **inside backtest.ts**,  
but *exposed* through `route.ts`.

Frontend reads:

```
results.analytics.backtest.rebalanceDates
```

If this array is empty → UI shows “0 rebalances”.

Thus `route.ts` is responsible for making sure:
- rebalance events exist  
- rebalance dates are forwarded  
- arrays are not overwritten  
- undefined values are not passed  

---

# 4. Common Failure Point

If backtest returns:
```
rebalanceEvents: [...]
rebalanceDates: [...]
```

but route.ts responds without forwarding them:

→ frontend shows *no* rebalancing  
→ page may crash  
→ timeline is empty  

This was the source of your earlier bug.

---

# 5. Why route.ts Does Not Define Risk Models

It simply:

- calls ERC optimizer  
- calls ES optimizer  
- passes results to frontend  
- formats analytics  

It **does not** change risk calculations.

---

# 6. Why route.ts Is Critical

Because it controls **the response structure**.

Even if:

- ERC works  
- ES works  
- backtest produces correct events  

If route.ts sends:
```
rebalanceDates: []
```

the frontend shows:
- no rebalancing  
- empty analytics  
- broken UI  

Thus documentation for route.ts helps future debugging.

---

End.
