# Portfolio Analysis Implementation Map

This document links every file that drives the **Full Analysis (Option 3)** experience and the `/dashboard/[id]` portfolio detail page. It reads like a README so you can jump directly to the React views, chart components, analytics engines, and API routes involved in generating charts, calculations, and pie visuals.

---

## 1. Core Pages (What you click)

**Full Analysis Builder** — `src/app/portfolio/full-analysis-option3/page.tsx`
- Client-only experience where the user chooses presets, toggles assets, flips ERC ↔ ES, and includes/excludes dividends.
- Calls `/api/risk-budgeting` to get weights, metrics, backtest values, risk contributions, and correlation data.
- Renders the charts/components listed later, launches PDF exports via `generatePortfolioPDF`, and saves the response with `updatePortfolio`.

**Dashboard Portfolio Detail** — `src/app/dashboard/[id]/page.tsx`
- Reads the saved portfolio via `getPortfolio`, hydrates Clerk auth, and watches for quote updates.
- Shows “since creation” and “optimized lookback” charts, rebalancing history, proposal weights, and any custom holdings.
- Reuses the saved `backtestResults` when they exist; otherwise it refetches stats from `/api/rebalancing-data` and `/api/historical-quotes`.

> Tip: Saving inside Full Analysis writes `proposalHoldings`, `proposalSummary`, `backtestResults`, and backtest dates straight into `portfolioStore`. The dashboard page simply renders those fields, so any schema change here must stay in lockstep.

---

## 2. Visual + UI Components (What the user sees)

- `src/components/ui/portfolio-components.tsx` – Shared layout primitives (`SectionCard`, `StrategyCard`, `InfoBox`, `Toggle`) plus the global `CHART_COLORS`.
- `src/components/portfolio/MetricCard.tsx` – KPI tiles for volatility, Sharpe, drawdown, etc.
- `src/components/portfolio/charts/PerformanceChart.tsx` – SVG equity curve used on the Full Analysis page (consumes `results.analytics.backtest`).
- `src/components/portfolio/charts/RiskContributionChart.tsx` – Horizontal bars to confirm ERC/ES risk balance.
- `src/components/portfolio/charts/AllocationPieChart.tsx` – Donut view of target weights.
- `src/components/PortfolioPerformanceChart.tsx` – Dashboard chart that overlays normalized portfolio value, creation marker, and rebalance flags.
- `src/components/PortfolioPerformanceSinceCreation.tsx` – Time series anchored to the portfolio’s `createdAt`, with next-rebalance countdown.
- `src/components/portfolio/PDFGenerator.ts` – `jspdf` helper the Full Analysis page uses for exports.

---

## 3. State & Persistence (Where data lives)

- `src/lib/portfolioStore.ts`
  - LocalStorage CRUD for everything a user builds.
  - Stores questionnaire answers, `proposalSummary`, `proposalHoldings`, `backtestResults`, `backtestStartDate`, `backtestEndDate`, historical holdings, and any rebalancing metadata.
  - Both core pages rely on `getPortfolio`, `listPortfolios`, and `updatePortfolio` for reads/writes.

---

## 4. Analytics Engines (How numbers happen)

- `src/lib/riskBudgeting.ts` – Computes total returns (with dividends), covariance matrices, volatility, risk contributions, Sharpe, drawdown, and runs the ERC optimizer.
- `src/lib/optimizerES.ts` – Expected Shortfall optimizer with tail-risk budgeting and optional risk-budget penalties.
- `src/lib/backtest.ts` – Quarterly rebalancing simulator (QARM methodology) that tracks values, dividends vs reinvested shadow portfolios, rebalance events, transaction costs, and performance stats.

These libs return raw metrics; the API layer shapes them for the React components.

---

## 5. API Routes & Data Pipelines (How data flows)

- `POST /api/risk-budgeting` (`src/app/api/risk-budgeting/route.ts`)
  - Main analytics endpoint. Pulls Yahoo Finance price/dividend history, aligns series, runs ERC or ES optimization, and executes `runBacktest`. Returns weights + metrics + charts payload.
- `POST /api/rebalancing-data` (`src/app/api/rebalancing-data/route.ts`)
  - Dashboard fallback when no cached `backtestResults` exist. Replays `runBacktest` with fixed weights and returns per-rebalance snapshots.
- `POST /api/historical-quotes` (`src/app/api/historical-quotes/route.ts`)
  - Fetches raw historical closes for arbitrary date ranges (feeds PortfolioPerformance charts).
- `POST /api/quotes` (`src/app/api/quotes/route.ts`)
  - Quick quote snapshot for proposal tables, dashboard summaries, and daily change percentages.
- `POST /api/portfolio-proposal` (`src/app/api/portfolio-proposal/route.ts`)
  - AI “Option 1” generator. Calls OpenAI for thesis + weights, then backfills prices via `/api/quotes`. These saved portfolios eventually appear on `/dashboard/[id]`.

Every route above depends on the analytics engines in Section 4; UI never touches raw math directly.

---

## 6. End-to-End Flow Checklist

1. **User configures assets on `full-analysis-option3/page.tsx`.** The page renders strategy presets, toggles, and chart shells using the UI components in Section 2.
2. **`handleGenerate` posts to `/api/risk-budgeting`.** That route fetches data, runs ERC/ES optimization (`riskBudgeting.ts` / `optimizerES.ts`), and calls `runBacktest`.
3. **Results render instantly.** `PerformanceChart`, `RiskContributionChart`, and `AllocationPieChart` visualize the payload; `MetricCard` plus InfoBoxes explain metrics. PDF exports are handled via `PDFGenerator.ts`.
4. **User saves the proposal.** `updatePortfolio` writes holdings + summary + backtest metadata (Section 3).
5. **Dashboard detail (`dashboard/[id]/page.tsx`) loads the saved portfolio.** If `backtestResults` exist they feed `PortfolioPerformanceChart`; otherwise it calls `/api/rebalancing-data` and `/api/historical-quotes`. Quotes refresh via `/api/quotes`.
6. **Charts stay in sync.** Both pages consume the shared chart components, so any change only happens once.

Keep this map handy to trace any regression in the Full Analysis builder, dashboard portfolio view, or the charts/calculations powering them.
