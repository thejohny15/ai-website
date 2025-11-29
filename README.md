# 📊 Risk Budgeting Portfolio Builder

An institutional-grade portfolio optimization platform using **Risk Budgeting** and **Equal Risk Contribution (ERC)** strategies.

## 🌟 Features

### **Portfolio Optimization**
- ✅ Equal Risk Contribution (ERC) algorithm
- ✅ Expected Shortfall (ES) optimizer with strict burn-in for stability
- ✅ Custom Risk Budgets (specify exact risk allocation)
- ✅ Volatility Targeting (leverage/cash adjustment)
- ✅ 14 asset classes (Equities, Bonds, Commodities, Alternatives)

### **Quick Start Presets**
- 🛡️ **Conservative** - Low volatility, capital preservation
- ⚖️ **Balanced** - Classic 60/40 approach
- 🚀 **Aggressive** - Growth-focused equity allocation

### **Advanced Analytics**
- 📈 **Historical Backtest** - rolling lookback (1y/3y/5y) with quarterly re-estimation
- 🔄 **Quarterly Rebalancing** - Automatic portfolio rebalancing
- 📊 **Strategy Comparison** - Compare vs Equal Weight + SPY benchmark overlay/metrics
- 🔥 **Stress Testing** - Volatility shocks & crisis scenarios
- 📉 **Max Drawdown Analysis** - Peak-to-trough decline tracking

### **Interactive Features**
- 🎨 Beautiful charts (portfolio allocation, risk contribution, performance)
- 📊 Live drifted risk contribution (recomputed nightly off latest close)
- 💾 Save portfolios to dashboard
- 📥 Export polished PDF reports (current holdings, benchmarks, analytics)
- 🔍 Hover tooltips with detailed metrics

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/my-ai-app.git
cd my-ai-app

# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📖 How It Works

### **Risk Budgeting Algorithm**

Instead of allocating capital equally, this platform allocates **risk equally**:

```
Traditional 60/40:
- 60% Stocks → Contributes 90% of portfolio risk
- 40% Bonds → Contributes 10% of portfolio risk
❌ Unbalanced risk!

Risk Budgeting:
- 35% Stocks → Contributes 50% of portfolio risk
- 65% Bonds → Contributes 50% of portfolio risk
✅ Equal risk contribution!
```

### **Key Calculations**

**Portfolio Volatility:**
```
σ_p = √(w^T × Σ × w)
```

**Risk Contribution:**
```
RC_i = (w_i × (Σw)_i) / σ_p
```

**Sharpe Ratio:**
```
Sharpe = Return / Volatility
```

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Convex (real-time database)
- **Auth**: Clerk (user authentication)
- **Data**: Yahoo Finance API
- **Deployment**: Vercel

## 📂 Project Structure

```
my-ai-app/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── risk-budgeting/    # Portfolio optimization API
│   │   ├── portfolio/
│   │   │   └── full-analysis-option3/  # Main portfolio builder
│   │   └── dashboard/             # User dashboard
│   ├── lib/
│   │   ├── riskBudgeting.ts       # ERC optimization algorithms
│   │   └── backtest.ts            # Historical simulation engine
│   └── convex/                    # Database schema & queries
├── ADVANCED_ANALYTICS_DOCS.md     # Detailed documentation
├── ANALYTICS_QUICK_REFERENCE.md   # Quick reference guide
└── README.md
```

## 📊 Documentation

- **[ERC & ES Risk-Budgeting Guide](./ERC_ES_README.md)** - Plain-English walkthrough of the optimizers, math, and how the API/backtest/front-end fit together
- **[Advanced Analytics Guide](./ADVANCED_ANALYTICS_DOCS.md)** - Complete implementation details
- **[Quick Reference](./ANALYTICS_QUICK_REFERENCE.md)** - Metrics cheat sheet

## 🎯 Use Cases

- **Pension Funds** - Balanced risk allocation across asset classes
- **Family Offices** - Sophisticated multi-asset portfolios
- **Individual Investors** - Institutional-grade strategies accessible to all
- **Financial Advisors** - Client portfolio construction tool

## 📈 Example Output

```
Portfolio Metrics (5-Year Backtest):
- Annual Return: 8.2%
- Volatility: 11.2%
- Sharpe Ratio: 0.73
- Max Drawdown: -15.3%

vs Equal Weight:
- Annual Return: 7.5%
- Volatility: 13.1%
- Sharpe Ratio: 0.57
- Max Drawdown: -18.7%

✅ Risk Budgeting wins on all metrics!
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.


## 🙏 Acknowledgments

- Risk Budgeting methodology based on research by Thierry Roncalli
- Historical data provided by Yahoo Finance API
- Inspired by institutional portfolio management practices

## 📧 Contact

For questions or feedback, please open an issue on GitHub.

---

**Built with ❤️ using Next.js and modern portfolio theory**

We use a rolling look-back window to estimate risk each time we rebalance.
The user selects the window length (1y, 3y, or 5y). At every quarterly rebalance (end of Mar/Jun/Sep/Dec), we re-estimate 
𝜇
μ and 
Σ
Σ from the most recent look-back window (e.g., last 5 years), solve the ES risk-budgeting optimization with the AI-exposure cap, and update weights. The initial portfolio for the backtest is the optimization computed at the first rebalance date using the window immediately preceding it.
For the current (“today”) portfolio, we apply the exact same process with a window that ends today (e.g., last 5 years up to today), then report the resulting weights.
