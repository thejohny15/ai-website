# ERC & ES Risk-Budgeting Guide

This note walks through how the app builds Equal Risk Contribution (ERC) and Expected Shortfall (ES) risk-budgeted portfolios, where the code lives, and the math each step uses. Files referenced are workspace-relative.

## Key Files
- `src/app/api/risk-budgeting/route.ts` — API endpoint that orchestrates data fetch, optimization (ERC or ES), metrics, and backtest.
- `src/lib/riskBudgeting.ts` — Core math for returns, covariance, ERC optimizer, Sharpe, drawdown, correlations.
- `src/lib/optimizerES.ts` — ES risk-parity optimizer with tail-risk budgets.
- `src/app/portfolio/full-analysis-option3/page.tsx` — Frontend flow to generate portfolios and display analytics.
- `src/lib/backtest.ts` (imported, not shown here) — Historical backtest, strategy comparison, stress testing.
- `src/lib/portfolioStore.ts` — Persists portfolio summary/backtest for dashboard.
- `src/app/dashboard/[id]/page.tsx` — Shows saved portfolios using stored results, including rebalance timelines.

## Data & Preprocessing
1. **Historical prices & dividends**  
   - `route.ts` fetches Yahoo Finance chart data per ticker (`fetchHistoricalData`), capturing closes, dates, and dividend events.
2. **Alignment**  
   - `alignPriceSeries` keeps only common dates across tickers; returns aligned price and dividend arrays.
3. **Returns** (`riskBudgeting.calculateReturns`)  
   - Price return: `(P_t - P_{t-1}) / P_{t-1}`.  
   - Total return (with dividends): `(P_t - P_{t-1} + D_t) / P_{t-1}`.
4. **Covariance** (`calculateCovarianceMatrix`)  
   - Sample covariance on daily returns, annualized by ×252.
5. **Correlation** (`calculateCorrelationMatrix`, `calculateAverageCorrelation`)  
   - ρ_ij = Cov(i,j) / (σ_i σ_j); average excludes the diagonal.

## ERC Optimizer (Variance Risk Parity)
File: `src/lib/riskBudgeting.ts`

- Goal: equal (or budgeted) variance risk contributions RC_i.  
  - Portfolio vol: `σ_p = sqrt(wᵀ Σ w)`.  
  - Marginal contribution: `MRC_i = (Σ w)_i / σ_p`.  
  - Risk contribution: `RC_i = w_i * MRC_i`.  
  - Percent share: `RC%_i = RC_i / Σ RC`.
- Algorithm: cyclical coordinate updates (Roncalli-style).  
  - Target RC per asset: equal = `σ_p / n` or custom budgets × `σ_p`.  
  - Update weight i: `w_i ← w_i * (targetRC / currentRC)^α`, with damping `α = 0.5`.  
  - Normalize weights to sum to 1 each iteration.  
  - Converges when max RC deviation < tolerance (default 1e-6 percentage points).
- Output: weights (sum to 1), RC percentages, portfolio volatility, convergence flag/iterations.

## ES Risk Parity Optimizer (Tail-Risk)
File: `src/lib/optimizerES.ts`

- Objective (long-only, fully invested, optional caps):  
  ```
  minimize_w   ES(w) + λ · Σ_i (RCshare_i(w) - b_i)²
  ```
  - ES term uses a Gaussian approximation: `ES(w) = -μᵀw + k_α · sqrt(wᵀ Σ w)` with `α=0.975` by default and `k_α = φ(z_α)/(1-α)`.
  - RCshare_i are tail-risk shares of the `k_α sqrt(wᵀΣw)` term (analogous to variance RC but for the ES component).
  - `b_i` are target risk budgets; if omitted, the penalty is off. `λ` strength defaults to 0.5 when budgets provided (route uses 400 for tight parity).
- Gradient-descent with Armijo backtracking; projection keeps weights ≥0, ≤cap, and sum = 1 (capped simplex projection).
- Outputs: weights, expected shortfall value, tail RC levels and shares, entropy `H = -Σ w_i log w_i`, diversification `D = e^H`, convergence/iterations.

## API Flow (ERC vs ES)
File: `src/app/api/risk-budgeting/route.ts`

1. **Inputs**: asset list (tickers/names), optional custom budgets (must sum to 100%), lookback (`1y/3y/5y`), includeDividends flag, optimizer (`erc` or `es`), optional targetVolatility.
2. **Data split**: download ~2× lookback days; align; split in half into:
   - In-sample (older half) → initial weights for backtest start.
   - Out-of-sample (newer half) → “today” stats and main optimization.
3. **In-sample optimization**:
   - ERC: `optimizeERC` on in-sample covariance.  
   - ES: `optimizeExpectedShortfall` on in-sample covariance.
4. **Out-of-sample optimization (main suggestion)**:
   - Build price/total returns for means; covariance on price returns.  
   - ERC: `optimizeERC(cov)`; ES: `optimizeExpectedShortfall(cov, budgets, λ=400)`.  
   - Optional volatility targeting scales weights: `w_final = w_base * (targetVol / σ_p)`.
5. **Metrics**:
   - Expected return: `Σ w_i μ_i` (annualized), Sharpe: `(ER - r_f)/(σ_p)` with r_f≈0.  
   - Max drawdown: weighted sum of per-asset MDD (approx).  
   - Correlation matrix & average correlation.  
   - ES extras when optimizer = ES: ES value, entropy H, diversification D, tail RC.
6. **Drifted weights / RC**: simulate buying with $10k at start of out-of-sample, mark-to-market at end, compute variance-based RC for drift monitoring.
7. **Backtest** (`runBacktest`): uses chosen optimizer mode, quarterly rebalancing, 0.1% transaction cost, dividend toggle. Outputs portfolio curve, rebalance events (weight changes, vol, Sharpe, qtr return, trading volume, costs), dividend cash/reinvestment, shadow portfolio, max DD period.
8. **Benchmark & comparison**: SPY benchmark series + metrics; equal-weight vs risk-budgeting comparison.
9. **Response shape**: weights (target + drifted RC), metrics, correlation data, ES analytics, volatility-targeting info, full analytics block (backtest, comparison, stress test), and diagnostic flags (iterations, convergence).

## Frontend Usage
- **Full analysis page** (`src/app/portfolio/full-analysis-option3/page.tsx`):  
  - Lets users pick assets, optimizer (ERC/ES), dividends toggle, lookback; calls `/api/risk-budgeting`.  
  - Renders allocations, RC charts, tables, backtest metrics, rebalance timeline, stress tests, benchmark comparison, dividend impact.  
  - Can save results to portfolio store and generate PDF (`components/portfolio/PDFGenerator.ts`).
- **Dashboard detail** (`src/app/dashboard/[id]/page.tsx`):  
  - Reads saved proposal summary/backtest from `portfolioStore`.  
  - Shows summary metrics, historical performance, saved rebalance timeline, drift, holdings, and PDF export.

## Mathematical Glossary (quick)
- Returns with dividends: `r_t = (P_t - P_{t-1} + D_t) / P_{t-1}`.  
- Covariance: `Σ_ij = E[(r_i - μ_i)(r_j - μ_j)] · 252`.  
- Portfolio vol: `σ_p = sqrt(wᵀ Σ w)`.  
- ERC RC: `RC_i = w_i (Σ w)_i / σ_p`; parity targets all RC_i equal (or per budget).  
- ES (Gaussian): `ES ≈ -μᵀw + k_α sqrt(wᵀ Σ w)`, with `k_α = φ(z_α)/(1-α)` at α=0.975.  
- Tail RC shares (ES optimizer): RCshare_i proportional to `w_i · (k_α Σ w)_i / sqrt(wᵀΣw)`.

## How Pieces Fit
1. **route.ts** drives the workflow: fetch → align → compute returns/covariance → optimize (ERC/ES) → optional vol-scaling → metrics → backtest → response.
2. **riskBudgeting.ts** supplies core stats and the ERC optimizer used twice (in-sample for backtest start, out-of-sample for “today” weights).
3. **optimizerES.ts** supplies ES risk-parity when `optimizer=es`.
4. **backtest.ts** replays the strategy with quarterly rebalancing and transaction costs, used by the API for analytics and by the dashboard for display.
5. **Frontend pages** render and persist the API outputs; `portfolioStore.ts` keeps them for the dashboard and PDF reports.

## Practical Tips
- To change the tail probability for ES, adjust `alpha` in `optimizeExpectedShortfall` (defaults to 0.975).  
- To loosen/tighten ES risk-parity, tune `budgetStrength` (λ). Route currently uses 400 for tight RC matching.  
- To add caps/constraints, pass `caps` into the ES optimizer; for ERC you’d need to extend `optimizeERC` with projection.  
- Volatility targeting is a simple scalar rescale; leverage/cash buffer strings are derived from the scaling factor.  
- Custom risk budgets: supply an array summing to 100% via the API; both ERC and ES respect it (ERC on variance RC, ES on tail RC).
