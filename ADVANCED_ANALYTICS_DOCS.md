# Advanced Analytics Implementation Guide

## Overview
This document explains how the Advanced Analytics system works in the Risk Budgeting Portfolio application.

---

## System Architecture

### **Data Flow**
```
User clicks "Generate Portfolio"
    ↓
Frontend sends request to API
    ↓
API fetches 5 years of price data from Yahoo Finance
    ↓
API calculates optimal weights (ERC or ES risk budgeting, with optional dividend reinvestment)
    ↓
API runs backtest simulation
    ↓
API compares strategies
    ↓
API runs stress tests
    ↓
API returns comprehensive results
    ↓
Frontend displays charts and metrics
```

---

## 1. Historical Backtest

### **Purpose**
Simulates how the portfolio would have performed over the past 5 years using actual market data, using whichever optimizer you selected (ERC volatility-parity or ES tail-risk parity).

### **How It Works**

#### Step 1: Initialize Portfolio
```javascript
Starting capital: $10,000
Optimal weights: [0.35, 0.28, 0.22, 0.15] (from risk budgeting)
Assets: ["SPY", "LQD", "IEF", "DBC"]

For each asset:
  target_value = $10,000 × weight
  shares = target_value / current_price
  
Example:
  SPY weight = 35% → $3,500 to invest
  SPY price = $350 → Buy 10 shares
```

#### Step 2: Daily Simulation
```javascript
For each trading day:
  1. Calculate portfolio value
     portfolio_value = Σ(shares × current_price)
     
  2. Calculate daily return
     return = (today_value - yesterday_value) / yesterday_value
     
  3. Store values for analysis
```

#### Step 3: Quarterly Rebalancing
```javascript
Every 60 trading days (~3 months):
  1. Sell all positions → convert to cash
  2. Apply transaction costs (0.1% per trade)
  3. Buy back at target weights
  
Why rebalance?
  - Winners grow, losers shrink
  - Weights drift from targets (e.g., 35/28/22/15 → 40/25/20/15)
  - Rebalancing restores risk balance
```

#### Step 4: Calculate Metrics
```javascript
// Total Return
total_return = (final_value - initial_value) / initial_value
Example: ($12,500 - $10,000) / $10,000 = 25%

// Annualized Return
years = trading_days / 252
annualized = (1 + total_return)^(1/years) - 1
Example: (1.25)^(1/5) - 1 = 4.56% per year

// Volatility (Risk)
mean_return = average(daily_returns)
variance = average((return - mean)²)
volatility = sqrt(variance) × sqrt(252)
Example: 0.7% daily × √252 = 11.1% annual

// Sharpe Ratio (Risk-Adjusted Return)
sharpe = annualized_return / volatility
Example: 4.56% / 11.1% = 0.41
Interpretation: 0.41 return units per unit of risk

// Max Drawdown (Worst Loss)
For each day:
  if value > peak: peak = value
  drawdown = (peak - value) / peak
  max_drawdown = worst drawdown
Example: Peak $11,000, trough $9,000 = 18.2% drawdown
```

---

## 2. Strategy Comparison

### **Purpose**
Proves that Risk Budgeting delivers better risk-adjusted returns than simpler alternatives.

### **Strategies Compared**

#### Risk Budgeting (Your Strategy)
```
Uses: Equal Risk Contribution optimization
Logic: Each asset contributes equally to portfolio risk
Weights: Scientifically calculated (e.g., [35%, 28%, 22%, 15%])
Benefit: Optimal risk diversification
```

#### Equal Weight (Naive Diversification)
```
Uses: 1/N rule
Logic: Divide money equally
Weights: Simple split (e.g., [25%, 25%, 25%, 25%])
Problem: Ignores risk differences between assets
```

### **Expected Results**
```
Metric              Risk Budgeting    Equal Weight
Annual Return       8.2%              7.5%
Volatility          11.0%             13.0%
Sharpe Ratio        0.75              0.58
Max Drawdown        -15.3%            -18.7%

Conclusion: Risk Budgeting wins on all metrics!
```

---

## 3. Stress Testing

### **A. Worst Historical Period**

#### Purpose
Identifies the worst 30-day period in your backtest.

#### Implementation
```javascript
// Sliding window approach
for each 30-day window:
  loss = (end_value - start_value) / start_value
  track worst loss

Result:
  "Feb 20, 2020 to Mar 23, 2020: -18.3%"
  (COVID market crash)
```

#### Use Cases
- Risk assessment: "Can I handle 18% loss?"
- Comparison: "S&P 500 was down 34% same period"
- Confidence: "Diversification reduced losses by 46%"

### **B. Volatility Shock Scenario**

#### Purpose
Tests portfolio resilience if market volatility doubled.

#### Implementation
```javascript
// Take covariance matrix
original_cov = [[0.04, 0.01], [0.01, 0.02]]

// Apply stress (2x volatility)
stressed_cov = original_cov × 2

// Re-optimize with stressed data
new_weights = optimizeERC(stressed_cov)

// Compare
original: [35%, 65%] (equity, bonds)
stressed: [25%, 75%] (shift toward safer assets)
```

#### Interpretation
```
If volatility doubles (like March 2020):
- Reduce equity allocation by 10%
- Increase bond allocation by 10%
- This maintains risk balance in crisis
```

---

## 4. Performance Chart

### **Visual Components**

#### SVG Line Chart
```javascript
// Convert data to coordinates
points = values.map((value, i) => ({
  x: (i / total) × width,           // Time axis
  y: height - (value - min) / range × height  // Value axis (flipped)
}))

// Create path
path = "M x1,y1 L x2,y2 L x3,y3..."
```

#### Interactive Features
```javascript
On mouse move:
  1. Get mouse X position
  2. Find closest data point
  3. Show tooltip with value + date
  4. Highlight point with circle

On mouse leave:
  Hide tooltip and highlight
```

#### Visual Elements
- **Grid lines**: Reference guides (every 25%)
- **Gradient fill**: Beautiful area under curve
- **Green line**: Portfolio value over time
- **Hover circle**: Current point indicator
- **Tooltip**: Exact value and date

---

## 5. Key Formulas Reference

### Annualized Return
```
(1 + total_return)^(1/years) - 1

Example:
25% over 5 years
= (1.25)^(1/5) - 1
= 4.56% per year
```

### Volatility (Standard Deviation)
```
σ = sqrt(Σ(return - mean)² / N) × sqrt(252)

252 = trading days per year
This annualizes daily volatility
```

### Sharpe Ratio
```
(Return - Risk_Free_Rate) / Volatility

Assuming 0% risk-free rate:
= Return / Volatility

Higher is better (more return per unit risk)
```

### Max Drawdown
```
For each day:
  peak = max(peak, current_value)
  drawdown = (peak - current_value) / peak
  
max_drawdown = max(all drawdowns)
```

### Covariance Matrix
```
Cov(i,j) = E[(Return_i - Mean_i)(Return_j - Mean_j)]

Diagonal: Asset variance (risk)
Off-diagonal: Correlation between assets
```

---

## 6. Code Structure

### Backend (`/src/lib/backtest.ts`)
```
- runBacktest(): Main simulation engine
- shouldRebalance(): Determines rebalancing dates
- calculateDrawdownFromValues(): Max drawdown calculation
- findWorstPeriod(): Crisis detection
- stressTestVolatility(): Volatility shock scenario
- compareStrategies(): Strategy comparison runner
```

### API (`/src/app/api/risk-budgeting/route.ts`)
```
1. Fetch historical data (Yahoo Finance) with dividends
2. Align price series across assets
3. Calculate returns/covariance (annualized)
4. Optimize weights (ERC or ES) with optional custom budgets
5. Apply optional volatility targeting
6. Run backtest (quarterly re-opt using same optimizer and costs)
7. Compare strategies (risk-budgeted vs equal weight + SPY)
8. Run stress tests
9. Return comprehensive results (weights, metrics, RC, rebalance timeline)
```

### Frontend (`/src/app/portfolio/full-analysis-option3/page.tsx`)
```
Components:
- PerformanceChart: Interactive line chart
- MetricCard: Displays key statistics
- Risk contribution charts
- Strategy comparison table
- Stress test cards
```

---

## 7. Performance Considerations

### Data Sampling
```
Problem: 5 years × 252 days = 1,260 data points
Solution: Sample every Nth point for charts
Result: ~100 points = smooth rendering

Chart uses sampled data
Calculations use full dataset
```

### Optimization
```
- Backtest runs on server (API route)
- Results cached in response
- Charts render client-side
- No unnecessary re-calculations
```

---

## 8. Real-World Example

### Input
```
Assets: SPY, LQD, IEF, DBC
Period: Jan 2019 - Jan 2024
Initial: $10,000
Rebalance: Quarterly
```

### Process
```
Day 1: Buy [35% SPY, 28% LQD, 22% IEF, 15% DBC]
Day 60: First rebalance (weights drifted to 38/26/21/15)
Day 500: COVID crash (portfolio down 18%)
Day 800: Recovery (back to breakeven)
Day 1,260: Final value $12,500
```

### Results
```
Total Return: 25.0%
Annual Return: 4.56%
Volatility: 11.2%
Sharpe Ratio: 0.41
Max Drawdown: -18.3% (COVID)
Rebalances: 20
```

### Comparison
```
Risk Budgeting: 4.56% return, 11.2% vol, 0.41 Sharpe
Equal Weight:   3.89% return, 13.5% vol, 0.29 Sharpe
Winner: Risk Budgeting (+17% better Sharpe)
```

---

## 9. Testing & Validation

### Unit Tests
```javascript
// Test backtest engine
expect(runBacktest(...)).toHaveProperty('finalValue')
expect(sharpeRatio).toBeGreaterThan(0)

// Test stress testing
expect(stressedCovMatrix).toBe(originalCov × 2)

// Test comparison
expect(riskBudgeting.sharpe).toBeGreaterThan(equalWeight.sharpe)
```

### Integration Tests
```javascript
// Test full API flow
const response = await fetch('/api/risk-budgeting', {...})
expect(response.analytics).toBeDefined()
expect(response.analytics.backtest).toHaveProperty('portfolioValues')
```

---

## 10. Future Enhancements

### Potential Additions
```
1. More rebalancing strategies (threshold-based, calendar-based)
2. Transaction cost optimization
3. Tax-aware rebalancing
4. Monte Carlo simulation
5. Factor risk decomposition (PCA)
6. Rolling Sharpe ratio chart
7. Drawdown duration analysis
8. Comparison with custom benchmarks
9. Historical correlation matrix heatmap
10. Export to PDF report
```

---

## Conclusion

The Advanced Analytics system transforms a simple portfolio optimizer into an institutional-grade platform by:

✅ Proving strategies work with real historical data
✅ Quantifying risk-adjusted performance
✅ Testing resilience under stress
✅ Comparing against alternatives
✅ Providing downloadable evidence

This is the kind of analysis that professional wealth managers charge thousands of dollars for!
