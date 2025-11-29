"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, Suspense } from "react";
import { useUser } from "@clerk/nextjs";
import { updatePortfolio } from "@/lib/portfolioStore";
import { CHART_COLORS, SectionCard, StrategyCard, InfoBox } from "@/components/ui/portfolio-components";
import { MetricCard } from "@/components/portfolio/MetricCard";
import { PerformanceChart } from "@/components/portfolio/charts/PerformanceChart";
import { RiskContributionChart } from "@/components/portfolio/charts/RiskContributionChart";
import { AllocationPieChart } from "@/components/portfolio/charts/AllocationPieChart";
import { generatePortfolioPDF } from "@/components/portfolio/PDFGenerator";


function RiskBudgetingPageContent() {
  const pid = useSearchParams().get("pid");
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? "";

  // Asset classes with their ETF tickers
  const [assetClasses, setAssetClasses] = useState([
    // Core Asset Classes
    { id: "equities", name: "US Equities", ticker: "SPY", enabled: true, description: "S&P 500 Index", category: "Equity" },
    { id: "corporate", name: "Corporate Bonds", ticker: "LQD", enabled: true, description: "Investment Grade", category: "Fixed Income" },
    { id: "sovereign", name: "Sovereign Bonds", ticker: "IEF", enabled: true, description: "7-10 Year Treasury", category: "Fixed Income" },
    { id: "commodities", name: "Commodities", ticker: "DBC", enabled: true, description: "Broad Commodity Index", category: "Alternatives" },
    
    // Additional Equity
    { id: "smallcap", name: "US Small Cap", ticker: "IWM", enabled: false, description: "Russell 2000", category: "Equity" },
    { id: "intl", name: "International Equities", ticker: "EFA", enabled: false, description: "Developed Markets ex-US", category: "Equity" },
    
    // Additional Fixed Income
    { id: "treasury-short", name: "Short-Term Treasuries", ticker: "SHY", enabled: false, description: "1-3 Year Treasury", category: "Fixed Income" },
    { id: "treasury-long", name: "Long-Term Treasuries", ticker: "TLT", enabled: false, description: "20+ Year Treasury", category: "Fixed Income" },
    { id: "highyield", name: "High Yield Bonds", ticker: "HYG", enabled: false, description: "Corporate Junk Bonds", category: "Fixed Income" },
    { id: "tips", name: "TIPS", ticker: "TIP", enabled: false, description: "Inflation-Protected", category: "Fixed Income" },
    
    // Alternatives
    { id: "reits", name: "Real Estate", ticker: "VNQ", enabled: false, description: "US REITs", category: "Alternatives" },
    { id: "gold", name: "Gold", ticker: "GLD", enabled: false, description: "Physical Gold", category: "Alternatives" },
    { id: "energy", name: "Energy", ticker: "XLE", enabled: false, description: "Energy Sector", category: "Alternatives" },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [lookbackPeriod, setLookbackPeriod] = useState< '1y' | '3y' | '5y'>('5y');
  const [includeDividends, setIncludeDividends] = useState(true);
  const [optimizer, setOptimizer] = useState<"erc" | "es">("erc"); // NEW: optimization mode (ERC / ES)

  function toggleAsset(id: string) {
    setAssetClasses(prev =>
      prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a)
    );
  }

  async function handleGenerate() {
    console.log("=== HANDLE GENERATE CALLED ===");
    setError(null);
    setResults(null); // Clear previous results
    
    const enabled = assetClasses.filter(a => a.enabled);
    console.log("Enabled assets:", enabled);
    
    if (enabled.length < 2) {
      setError("Please select at least 2 asset classes");
      return;
    }

    try {
      setLoading(true);
      
      const payload = { 
        assetClasses: enabled.map(a => ({ ticker: a.ticker, name: a.name })),
        lookbackPeriod: lookbackPeriod,
        includeDividends: includeDividends,
      };

      console.log("Calling API with payload:", payload);

      // pass optimizer to API
      const res = await fetch(`/api/risk-budgeting?optimizer=${optimizer}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      console.log("API response status:", res.status);
      console.log("API response headers:", res.headers);
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error("API error response:", errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${res.status}` };
        }
        console.error("API error:", errorData);
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }
      
      const data = await res.json();
      console.log("=== API RESPONSE DATA ===", data);
      setResults(data);
    } catch (e: any) {
      console.error("=== ERROR IN HANDLE GENERATE ===", e);
      setError(e.message || "Failed to generate portfolio");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!pid || !userId || !results) return;

    try {
      setSaving(true);

      console.log('=== SAVING PORTFOLIO ===');
      console.log('Results object:', results);
      console.log('Has analytics?', results.analytics);
      console.log('Has backtest?', results.analytics?.backtest);

      // Convert results to holdings format compatible with portfolio store
      const holdings = results.weights.map((w: any) => {
        const weightValue =
          typeof w.weightRaw === "number" ? w.weightRaw : parseFloat(w.weight);
        return {
          symbol: w.ticker,
          weight: weightValue,
          note: `${w.name} • Risk Contribution: ${w.riskContribution}%`,
        };
      });

      // Create a summary object with risk budgeting details
      const summary = {
        methodology: optimizer === "es"
          ? "Expected Shortfall Risk Budgeting (ES)"
          : "Equal Risk Contribution (ERC)",
        portfolioVolatility: `${results.metrics.portfolioVolatility}%`,
        sharpeRatio: results.metrics.sharpeRatio,
        expectedReturn: `${results.metrics.expectedReturn}%`,
        maxDrawdown: `${results.metrics.maxDrawdown}%`,
        dataAsOf: results.asOf,
        lookbackPeriod: lookbackPeriod,
        optimization: {
          converged: results.optimization?.converged,
          iterations: results.optimization?.iterations,
        },
        volatilityTargeting: results.volatilityTargeting || undefined,
        correlationMatrix: results.correlationMatrix || undefined,
        avgCorrelation: results.avgCorrelation || undefined,
      };

      // Save backtest results from API response
      const backtestResults = results.analytics?.backtest ? {
        portfolioValues: results.analytics.backtest.portfolioValues,
        dates: results.analytics.backtest.dates,
        finalValue: parseFloat(results.analytics.backtest.finalValue),
        totalReturn: parseFloat(results.analytics.backtest.totalReturn),
        annualizedReturn: parseFloat(results.analytics.backtest.annualizedReturn),
        annualizedVolatility: parseFloat(results.analytics.backtest.annualizedVolatility),
        sharpeRatio: parseFloat(results.analytics.backtest.sharpeRatio),
        maxDrawdown: parseFloat(results.analytics.backtest.maxDrawdown),
        rebalanceDates: results.analytics.backtest.rebalanceDates,
        dividendCash: results.analytics.backtest.dividendCash,
        dividendCashIfReinvested: results.analytics.backtest.dividendCashIfReinvested,
        shadowPortfolioValue: results.analytics.backtest.shadowPortfolioValue,
        shadowTotalReturn: results.analytics.backtest.shadowTotalReturn,
        currentRiskContributions: results.analytics.backtest.currentRiskContributions,
      } : undefined;

      console.log('Backtest results to save:', backtestResults);
      console.log('Has rebalanceDates?', backtestResults?.rebalanceDates?.length);

      // Save backtest date range
      const backtestStartDate = results.analytics?.backtest?.dates?.[0];
      const backtestEndDate = results.analytics?.backtest?.dates?.[results.analytics.backtest.dates.length - 1];

      console.log('Backtest date range:', backtestStartDate, 'to', backtestEndDate);

      // Update the portfolio with the risk budgeting results AND backtest data
      const updated = updatePortfolio(userId, pid, {
        proposalHoldings: holdings,
        proposalSummary: summary,
        backtestResults: backtestResults,
        backtestStartDate: backtestStartDate,
        backtestEndDate: backtestEndDate,
      });

      console.log('Portfolio updated:', updated);
      console.log('Saved backtestResults:', updated?.backtestResults);

      // Navigate to dashboard detail page
      router.push(`/dashboard/${pid}`);
    } catch (e: any) {
      console.error("Error saving portfolio:", e);
      setError(e.message || "Failed to save portfolio");
    } finally {
      setSaving(false);
    }
  }

  if (!pid) {
    if (typeof window !== "undefined") router.replace("/dashboard");
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-4xl font-bold text-white drop-shadow-lg mb-3">Risk Budgeting Portfolio</h1>
        <p className="text-lg text-slate-200 font-medium">
          Institutional-grade multi-asset allocation using quantitative risk management
        </p>

        {/* NEW: Optimizer selector – ERC vs ES, placed near top of full-analysis page */}
        <div className="mt-4 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-200">Optimizer</span>
          <div className="inline-flex rounded-lg bg-slate-900/70 border border-slate-600/70 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setOptimizer("erc")}
              className={`px-3 py-1.5 ${
                optimizer === "erc"
                  ? "bg-emerald-500 text-white font-semibold"
                  : "text-slate-200 hover:bg-slate-700/60"
              }`}
            >
              ERC
            </button>
            <button
              type="button"
              onClick={() => setOptimizer("es")}
              className={`px-3 py-1.5 border-l border-slate-700 ${
                optimizer === "es"
                  ? "bg-fuchsia-500 text-white font-semibold"
                  : "text-slate-200 hover:bg-slate-700/60"
              }`}
            >
              ES
            </button>
          </div>
          <span className="text-xs text-slate-400">
            {optimizer === "erc"
              ? "Equal Risk Contribution optimization."
              : "Expected Shortfall–based risk budgeting."}
          </span>
        </div>

        {/* Quick Strategy Presets */}
        <SectionCard className="mt-8">
          <h2 className="text-xl font-bold mb-5 text-white">Quick Start: Choose a Strategy</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StrategyCard
              icon="🛡️"
              title="Conservative"
              description="Capital preservation focused. Low volatility, stable income."
              features={[
                "100% Fixed Income",
                "Government & Corporate Bonds",
                "Natural allocation (no leverage)",
                "Best for: Retirees, risk-averse"
              ]}
              borderColor="emerald"
              onClick={() => {
                setAssetClasses(prev => prev.map(a => ({
                  ...a,
                  enabled: ['sovereign', 'treasury-short', 'corporate', 'tips'].includes(a.id)
                })));
              }}
            />
            <StrategyCard
              icon="⚖️"
              title="Balanced"
              description="Classic diversified approach. Growth with downside protection."
              features={[
                "Stocks, Bonds & Commodities",
                "Risk-balanced allocation",
                "Natural allocation (no leverage)",
                "Best for: Long-term investors"
              ]}
              borderColor="blue"
              onClick={() => {
                setAssetClasses(prev => prev.map(a => ({
                  ...a,
                  enabled: ['equities', 'corporate', 'sovereign', 'commodities'].includes(a.id)
                })));
              }}
            />
            <StrategyCard
              icon="🚀"
              title="Aggressive"
              description="Maximum growth potential. Higher risk, higher returns."
              features={[
                "100% Global Equities",
                "US, International & Emerging",
                "Natural allocation (no leverage)",
                "Best for: Young, growth-focused"
              ]}
              borderColor="rose"
              onClick={() => {
                setAssetClasses(prev => prev.map(a => ({
                  ...a,
                  enabled: ['equities', 'smallcap', 'intl', 'reits', 'commodities'].includes(a.id)
                })));
              }}
            />
          </div>
        </SectionCard>

        {/* Asset Class Selection */}
        <SectionCard className="mt-8">
          <h2 className="text-xl font-bold mb-4 text-white">Select Asset Classes</h2>
          <p className="text-sm text-slate-200 mb-4">
            Choose at least 2 asset classes. Each will contribute equally to portfolio risk.
            Start with the 4 core assets (already selected) or customize your allocation.
          </p>
          
          {/* Category-based selection */}
          {["Equity", "Fixed Income", "Alternatives"].map((category) => (
            <div key={category} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">
                {category}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {assetClasses
                  .filter((a) => a.category === category)
                  .map((asset) => (
                    <label
                      key={asset.id}
                      className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition ${
                        asset.enabled
                          ? "border-slate-400/60 bg-slate-700/50"
                          : "border-slate-600/40 bg-slate-800/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={asset.enabled}
                        onChange={() => toggleAsset(asset.id)}
                        className="mt-1 h-5 w-5 rounded"
                      />
                      <div className="flex-1">
                        <div className="font-semibold text-white">{asset.name}</div>
                        <div className="text-sm text-slate-300">
                          {asset.ticker} • {asset.description}
                        </div>
                      </div>
                    </label>
                  ))}
              </div>
            </div>
          ))}
          
          {/* Quick actions */}
          <div className="mt-4 pt-4 border-t border-slate-600/30 flex flex-wrap gap-2">
            <button
              onClick={() => setAssetClasses(prev => prev.map(a => ({ ...a, enabled: true })))}
              className="text-sm px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600/50 hover:bg-slate-600/60 transition"
            >
              Select All
            </button>
            <button
              onClick={() => setAssetClasses(prev => prev.map(a => ({ ...a, enabled: false })))}
              className="text-sm px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600/50 hover:bg-slate-600/60 transition"
            >
              Deselect All
            </button>
            <button
              onClick={() => setAssetClasses(prev => prev.map(a => ({ 
                ...a, 
                enabled: a.id === "equities" || a.id === "corporate" || a.id === "sovereign" || a.id === "commodities" 
              })))}
              className="text-sm px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600/50 hover:bg-slate-600/60 transition"
            >
              Reset to Core 4
            </button>
            <span className="ml-auto text-sm text-slate-200 self-center font-medium">
              {assetClasses.filter(a => a.enabled).length} selected
            </span>
          </div>
        </SectionCard>

        {/* Return Calculation Toggle */}
        <SectionCard className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Return Calculation</h2>
              <p className="text-sm text-slate-200 mt-1">
                {includeDividends 
                  ? "Including dividend yields in all return calculations (automatically reinvested, recommended)"
                  : "Price returns only (excludes dividend income)"}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-slate-200">Include Dividends</span>
              <input
                type="checkbox"
                checked={includeDividends}
                onChange={(e) => setIncludeDividends(e.target.checked)}
                className="h-5 w-5 rounded"
              />
            </label>
          </div>

          <InfoBox variant="emerald">
            <p>
              <strong>Dividends Matter:</strong> ETFs like SPY (~1.5% yield), LQD (~3-4% yield), and TLT (~2-3% yield) 
              pay regular dividends. Dividends are automatically reinvested to buy additional shares. 
              Over 5 years, this can add 10-20% to total returns. 
              {includeDividends 
                ? " ✓ We're including them for accurate performance measurement."
                : " ⚠️ Excluding dividends will underestimate true returns."}
            </p>
          </InfoBox>
        </SectionCard>

        {/* Analysis Time Period */}
        <div className="mt-6 rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Analysis Time Period</h2>
              <p className="text-sm text-slate-200 mt-1">
                Historical data lookback for all calculations (returns, volatility, correlations, max drawdown)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { value: '1y', label: 'Last Year', description: '1 year', days: '~252 days' },
              { value: '3y', label: 'Last 3 Years', description: '3 years', days: '~756 days' },
              { value: '5y', label: 'Last 5 Years', description: '5 years', days: '~1,260 days' },
            ].map((period) => (
              <button
                key={period.value}
                onClick={() => setLookbackPeriod(period.value as any)}
                className={`rounded-xl border-2 p-4 text-left transition ${
                  lookbackPeriod === period.value
                    ? 'border-emerald-400 bg-emerald-500/20'
                    : 'border-slate-600/40 bg-slate-800/40 hover:bg-slate-700/50'
                }`}
              >
                <div className="font-semibold text-base mb-1">{period.label}</div>
                <div className="text-xs text-slate-300">{period.description}</div>
                <div className="text-xs text-slate-400 mt-1">{period.days}</div>
              </button>
            ))}
          </div>

          <InfoBox variant="blue">
            <p>
              <strong>Tip:</strong> Shorter periods (1y) capture recent market conditions. 
              Longer periods (3y, 5y) provide more stable estimates but may include outdated correlations.
              {lookbackPeriod === '1y' && ' Good balance of recency and statistical reliability.'}
              {lookbackPeriod === '3y' && ' Captures full market cycle with recent regime.'}
              {lookbackPeriod === '5y' && ' Most statistically robust, includes multiple market environments.'}
            </p>
          </InfoBox>
        </div>

        {/* Risk Model */}
        <div className="mt-6 rounded-2xl border border-slate-600/40 bg-slate-800/40 p-6 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Risk Model</h2>
              <p className="text-sm text-slate-200 mt-1">
                Select how portfolio risk is defined and allocated.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setOptimizer("erc")}
              className={`w-full rounded-xl border p-4 text-left transition ${
                optimizer === "erc"
                  ? "border-green-500 bg-green-900/30 text-white"
                  : "border-slate-600 text-slate-300 bg-slate-900/40 hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">ERC (Equal Risk Contribution)</span>
                {optimizer === "erc" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-100">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-200">
                Balances volatility evenly across assets.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setOptimizer("es")}
              className={`w-full rounded-xl border p-4 text-left transition ${
                optimizer === "es"
                  ? "border-green-500 bg-green-900/30 text-white"
                  : "border-slate-600 text-slate-300 bg-slate-900/40 hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">ES (Expected Shortfall)</span>
                {optimizer === "es" && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-100">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-200">
                Focuses on minimizing losses in the worst 5 % of outcomes.
              </p>
            </button>
          </div>

          <p className="mt-4 text-xs text-slate-300">
            Tip: ES captures tail risk, while ERC equalizes volatility exposure. Use ES for stress-testing portfolios.
          </p>
        </div>

        {/* Generate Button */}
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-6 py-3 font-semibold shadow-lg hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "Calculating..." : "Generate Portfolio"}
          </button>
          
          {error && (
            <p className="text-sm text-red-300">{error}</p>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-8 backdrop-blur text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white mb-4"></div>
            <h3 className="text-lg font-semibold mb-2">Optimizing Portfolio...</h3>
            <p className="text-sm text-white/80">
              Fetching historical data and calculating risk-balanced allocation
            </p>
          </div>
        )}

        {/* Results Section */}
        {results && (
          <div className="mt-8 space-y-6 animate-fadeIn">
            {/* Visual Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Allocation Pie Chart */}
              <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur">
                <h2 className="text-xl font-semibold mb-4">Portfolio Allocation</h2>
                <AllocationPieChart weights={results.weights} />
              </div>

              {/* Risk Contribution Bar Chart */}
              <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur">
                <h2 className="text-xl font-semibold mb-4">Risk Contributions</h2>
                <RiskContributionChart weights={results.weights} />
              </div>
            </div>

            {/* Allocation Table */}
            <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Optimal Allocation</h2>
                <span className="text-sm text-white/70">
                  {results.weights.length} asset{results.weights.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              {/* Comparison Insight */}
              <div className="mb-4 rounded-xl border border-blue-300/30 bg-blue-500/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="text-blue-300 mt-0.5">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zm-4 4a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="flex-1 text-sm text-blue-100">
                    <strong>Notice:</strong> Weights are unequal, but risk contributions are equal. 
                    Lower-volatility assets get higher weights to contribute the same risk as higher-volatility assets.
                    {results.volatilityTargeting && parseFloat(results.volatilityTargeting.scalingFactor) > 1 && (
                      <span className="block mt-2">
                        <strong>Leverage:</strong> Weights sum to {results.weights.reduce((sum: number, w: any) => sum + parseFloat(w.weight), 0).toFixed(0)}% due to volatility targeting (requires {results.volatilityTargeting.leverage}).
                      </span>
                    )}
                    {results.volatilityTargeting && parseFloat(results.volatilityTargeting.scalingFactor) < 1 && (
                      <span className="block mt-2">
                        <strong>Cash Buffer:</strong> Weights sum to {results.weights.reduce((sum: number, w: any) => sum + parseFloat(w.weight), 0).toFixed(0)}% with {results.volatilityTargeting.leverage} to reduce volatility.
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-white/80 border-b border-white/20">
                      <th className="py-3 pr-6">Asset Class</th>
                      <th className="py-3 pr-6">Ticker</th>
                      <th className="py-3 pr-6 text-right">Weight</th>
                      <th className="py-3 text-right">Risk Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.weights.map((item: any) => (
                      <tr key={item.ticker} className="border-b border-white/10">
                        <td className="py-3 pr-6 font-semibold">{item.name}</td>
                        <td className="py-3 pr-6 text-white/80">{item.ticker}</td>
                        <td className="py-3 pr-6 text-right font-semibold">{item.weight}%</td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-2 rounded-full bg-white/20 w-20">
                              <div
                                className="h-full rounded-full bg-emerald-400"
                                style={{ width: `${item.riskContribution}%` }}
                              />
                            </div>
                            <span className="font-semibold">{item.riskContribution}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-6 rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="text-emerald-300 mt-0.5">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-emerald-200">
                      <strong>Equal Risk Contribution achieved:</strong>{" "}
                      Each asset contributes equally ({(100 / results.weights.length).toFixed(2)}%) to total portfolio risk, maximizing diversification while respecting each asset&apos;s risk characteristics.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced Analytics Section */}
            {results.analytics && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold mt-8">📊 Advanced Analytics</h2>
                
                {/* Historical Backtest */}
                <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur">
                  <h3 className="text-xl font-semibold mb-4">Historical Performance</h3>
                  
                  {/* Performance Chart */}
                  <div className="mb-6">
                    <PerformanceChart 
                      values={results.analytics.backtest.portfolioValues} 
                      dates={results.analytics.backtest.dates}
                    />
                  </div>
                  
                  {/* Backtest Metrics */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <MetricCard 
                      label={results.includeDividends ? "Total Return (with dividends)" : "Total Return (price only)"} 
                      value={`${results.analytics.backtest.totalReturn}%`} 
                    />
                    <MetricCard label="Ann. Return" value={`${results.analytics.backtest.annualizedReturn}%`} />
                    <MetricCard label="Ann. Volatility" value={`${results.analytics.backtest.annualizedVolatility}%`} />
                    <MetricCard label="Sharpe Ratio" value={results.analytics.backtest.sharpeRatio} />
                    <MetricCard label="Max Drawdown" value={`${results.analytics.backtest.maxDrawdown}%`} />
                    <MetricCard label="Rebalances" value={results.analytics.backtest.rebalanceCount.toString()} />
                    <MetricCard 
                      label="Final Value" 
                      value={`$${results.analytics.backtest.finalValue}`} 
                    />
                    <MetricCard label="Initial Value" value="$10,000" />
                  </div>
                  
                  {/* Dividend Cash Info */}
                  {results.analytics.backtest.dividendCash && results.analytics.backtest.dividendCash > 0 && (
                    <div className="mt-4 p-4 rounded-xl border border-emerald-300/30 bg-emerald-500/10">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5 text-emerald-300" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm font-semibold text-emerald-100">
                            {results.includeDividends 
                              ? "💰 Dividends Received & Reinvested:" 
                              : "💵 Dividend Cash Generated (sitting idle):"}
                          </span>
                        </div>
                        <span className="text-lg font-bold text-emerald-50">
                          ${results.analytics.backtest.dividendCash.toFixed(2)}
                        </span>
                      </div>
                      {results.includeDividends && (
                        <p className="text-xs text-emerald-200/80 mt-2">
                          These dividends were automatically reinvested to buy additional shares, compounding your returns over time.
                        </p>
                      )}
                      {!results.includeDividends && (
                        <p className="text-xs text-emerald-200/80 mt-2">
                          ⚠️ This cash is not included in the portfolio value above. Enable dividend reinvestment to see the full impact!
                        </p>
                      )}
                    </div>
                  )}
                  
                  {/* Comparison: With vs Without Reinvestment (when OFF) */}
                  {!results.includeDividends && results.analytics.backtest.shadowPortfolioValue && (
                    <div className="mt-4 p-5 rounded-xl border-2 border-amber-300/40 bg-gradient-to-br from-amber-500/15 to-orange-500/10">
                      <h4 className="text-base font-bold text-amber-100 mb-3 flex items-center gap-2">
                        <span>⚡</span> Opportunity Cost Analysis
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {/* Current Strategy (No Reinvestment) */}
                        <div className="rounded-lg bg-slate-800/60 p-4 border border-slate-600/40">
                          <div className="text-xs text-slate-300 mb-1">❌ Without Reinvestment</div>
                          <div className="space-y-2">
                            <div>
                              <div className="text-xs text-slate-400">Portfolio Value:</div>
                              <div className="text-xl font-bold text-white">${results.analytics.backtest.finalValue}</div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-400">+ Cash (sitting idle):</div>
                              <div className="text-lg font-semibold text-slate-200">
                                ${results.analytics.backtest.dividendCash.toFixed(2)}
                              </div>
                            </div>
                            <div className="pt-2 border-t border-slate-600/50">
                              <div className="text-xs text-slate-400">Total Value:</div>
                              <div className="text-2xl font-bold text-amber-200">
                                ${(parseFloat(results.analytics.backtest.finalValue) + results.analytics.backtest.dividendCash).toFixed(2)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-400">Total Return:</div>
                              <div className="text-lg font-semibold text-slate-200">
                                {((parseFloat(results.analytics.backtest.finalValue) + results.analytics.backtest.dividendCash - 10000) / 10000 * 100).toFixed(2)}%
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* With Reinvestment (Shadow Portfolio) */}
                        <div className="rounded-lg bg-emerald-900/40 p-4 border-2 border-emerald-400/50 shadow-lg">
                          <div className="text-xs text-emerald-200 mb-1 flex items-center gap-1.5">
                            <span>✅ With Reinvestment</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/30 border border-emerald-400/40">Recommended</span>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <div className="text-xs text-emerald-300/80">Portfolio Value:</div>
                              <div className="text-xl font-bold text-emerald-50">
                                ${results.analytics.backtest.shadowPortfolioValue.toFixed(2)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-emerald-300/80">Dividends reinvested:</div>
                              <div className="text-lg font-semibold text-emerald-100">
                                ${results.analytics.backtest.dividendCashIfReinvested?.toFixed(2) || '0.00'}
                              </div>
                            </div>
                            <div className="pt-2 border-t border-emerald-500/30">
                              <div className="text-xs text-emerald-300/80">Total Value:</div>
                              <div className="text-2xl font-bold text-emerald-50">
                                ${results.analytics.backtest.shadowPortfolioValue.toFixed(2)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-emerald-300/80">Total Return:</div>
                              <div className="text-lg font-semibold text-emerald-100">
                                {results.analytics.backtest.shadowTotalReturn?.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Impact Summary */}
                      <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-400/30">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-red-200">
                            {(results.analytics.backtest.shadowPortfolioValue - (parseFloat(results.analytics.backtest.finalValue) + results.analytics.backtest.dividendCash)) > 0 
                              ? "💸 You're Missing Out:" 
                              : "⚠️ Interesting Market Dynamic:"}
                          </span>
                          <span className="text-xl font-bold text-red-100">
                            ${Math.abs(results.analytics.backtest.shadowPortfolioValue - (parseFloat(results.analytics.backtest.finalValue) + results.analytics.backtest.dividendCash)).toFixed(2)}
                          </span>
                        </div>
                        {(results.analytics.backtest.shadowPortfolioValue - (parseFloat(results.analytics.backtest.finalValue) + results.analytics.backtest.dividendCash)) > 0 ? (
                          <p className="text-xs text-red-200/70 mt-1">
                            By not reinvesting dividends, you're leaving money on the table due to lost compounding.
                          </p>
                        ) : (
                          <div className="text-xs text-amber-200/90 mt-2 space-y-1">
                            <p className="font-semibold">
                              📊 Sequence-of-Returns Risk: In this backtest period, holding cash actually preserved more value.
                            </p>
                            <p>
                              When prices declined after dividend payments, reinvesting bought shares that subsequently lost value. 
                              This is typical in bear markets (like 2022&apos;s bond decline). Over longer periods and full market cycles, 
                              DRIP typically wins due to compounding, but timing matters!
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="mt-4 text-sm text-white/70">
                    Worst Period: {results.analytics.backtest.maxDrawdownPeriod.start} to {results.analytics.backtest.maxDrawdownPeriod.end} ({results.analytics.backtest.maxDrawdown}% decline)
                  </div>
                  
                  {/* Rebalancing Timeline */}
                  {results.analytics.backtest.rebalanceDates && results.analytics.backtest.rebalanceDates.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-white/20">
                      <h4 className="font-semibold mb-3">Rebalancing Timeline</h4>
                      <p className="text-sm text-white/70 mb-4">
                        Portfolio was rebalanced {results.analytics.backtest.rebalanceCount} times (quarterly) to maintain risk balance. 
                        Each rebalance incurred 0.1% transaction costs.
                      </p>
                      <div className="max-h-60 overflow-y-auto space-y-2">
                        {results.analytics.backtest.rebalanceDates.map((rebalance: any, idx: number) => {
                          // Calculate total rebalancing magnitude
                          const totalRebalanceMagnitude = rebalance.changes?.reduce((sum: number, change: any) => {
                            const allocationChange = Math.abs(parseFloat(change.afterWeight) - parseFloat(change.beforeWeight));
                            return sum + allocationChange;
                          }, 0) || 0;

                          // Calculate trading volume in dollars (half of rebalance magnitude applied to portfolio value)
                          const portfolioValue = typeof rebalance.portfolioValue === 'string' 
                            ? parseFloat(rebalance.portfolioValue.replace(/,/g, ''))
                            : rebalance.portfolioValue;
                          const tradingVolumeDollars = (totalRebalanceMagnitude / 2 / 100) * portfolioValue;
                          
                          // Calculate transaction costs in dollars (0.1% of trading volume)
                          const transactionCostDollars = tradingVolumeDollars * 0.001;

                          return (
                            <div key={idx} className="rounded-lg bg-white/5 border border-white/10 p-3">
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-sm font-semibold">
                                  Rebalance #{idx + 1} - {rebalance.date}
                                </span>
                                <span className="text-xs text-white/60">
                                  Portfolio: ${rebalance.portfolioValue}
                                </span>
                              </div>
                              <div className="grid grid-cols-5 gap-4">
                                {/* Column 1-3: Weight Changes */}
                                <div className="col-span-3 grid grid-cols-2 gap-x-4 gap-y-1">
                                  {rebalance.changes && rebalance.changes.map((change: any, i: number) => {
                                    const beforeWeight = parseFloat(change.beforeWeight);
                                    const afterWeight = parseFloat(change.afterWeight);
                                    const allocationChange = afterWeight - beforeWeight;
                                    
                                    return (
                                      <div key={i} className="flex items-center gap-1.5 text-xs">
                                        <span className="text-white/70 font-medium min-w-[45px]">{change.ticker}:</span>
                                        <span className="text-white/90">
                                          {change.beforeWeight}% → {change.afterWeight}%
                                        </span>
                                        <span className={`text-xs font-bold ${
                                          allocationChange > 0 ? 'text-emerald-400' : allocationChange < 0 ? 'text-red-400' : 'text-slate-400'
                                        }`}>
                                          ({allocationChange > 0 ? '+' : ''}{allocationChange.toFixed(2)}%)
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                                
                                {/* Column 4-5: Portfolio Metrics - Two columns */}
                                <div className="col-span-2 border-l border-white/20 pl-4 grid grid-cols-2 gap-x-4 gap-y-1">
                                  {/* Left Column */}
                                  <div className="space-y-1">
                                    {rebalance.volatility && (
                                      <div className="text-xs">
                                        <span className="text-white/60">Vol:</span>{' '}
                                        <span className="text-white/90 font-semibold">{rebalance.volatility}%</span>
                                      </div>
                                    )}
                                    {rebalance.sharpe && (
                                      <div className="text-xs">
                                        <span className="text-white/60">Sharpe:</span>{' '}
                                        <span className="text-white/90 font-semibold">{rebalance.sharpe}</span>
                                      </div>
                                    )}
                                    <div className="text-xs">
                                      <span className="text-white/60">Total Rebalancing:</span>{' '}
                                      <span className="text-white/90 font-semibold">{totalRebalanceMagnitude.toFixed(2)}%</span>
                                    </div>
                                  </div>
                                  
                                  {/* Right Column */}
                                  <div className="space-y-1">
                                    {rebalance.quarterlyReturn !== undefined && (
                                      <div className="text-xs">
                                        <span className="text-white/60">Qtr Return:</span>{' '}
                                        <span className={`font-semibold ${
                                          parseFloat(rebalance.quarterlyReturn) >= 0 ? 'text-emerald-400' : 'text-red-400'
                                        }`}>
                                          {parseFloat(rebalance.quarterlyReturn) > 0 ? '+' : ''}{rebalance.quarterlyReturn}%
                                        </span>
                                      </div>
                                    )}
                                    <div className="text-xs">
                                      <span className="text-white/60">Trading Volume:</span>{' '}
                                      <span className="text-white/90 font-semibold">${tradingVolumeDollars.toFixed(2)}</span>
                                    </div>
                                    <div className="text-xs">
                                      <span className="text-white/60">Transaction Costs:</span>{' '}
                                      <span className="text-white/90 font-semibold">${transactionCostDollars.toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Strategy Comparison */}
                <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur">
                  <h3 className="text-xl font-semibold mb-4">Strategy Comparison</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-white/80 border-b border-white/20">
                          <th className="py-3 pr-6">Strategy</th>
                          <th className="py-3 pr-6 text-right">Return</th>
                          <th className="py-3 pr-6 text-right">Volatility</th>
                          <th className="py-3 pr-6 text-right">Sharpe</th>
                          <th className="py-3 text-right">Max DD</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-white/10 bg-emerald-500/10">
                          <td className="py-3 pr-6 font-semibold">Risk Budgeting</td>
                          <td className="py-3 pr-6 text-right font-semibold">{results.analytics.comparison.riskBudgeting.return}%</td>
                          <td className="py-3 pr-6 text-right">{results.analytics.comparison.riskBudgeting.volatility}%</td>
                          <td className="py-3 pr-6 text-right">{results.analytics.comparison.riskBudgeting.sharpe}</td>
                          <td className="py-3 text-right">{results.analytics.comparison.riskBudgeting.maxDrawdown}%</td>
                        </tr>
                        <tr className="border-b border-white/10">
                          <td className="py-3 pr-6">Equal Weight</td>
                          <td className="py-3 pr-6 text-right">{results.analytics.comparison.equalWeight.return}%</td>
                          <td className="py-3 pr-6 text-right">{results.analytics.comparison.equalWeight.volatility}%</td>
                          <td className="py-3 pr-6 text-right">{results.analytics.comparison.equalWeight.sharpe}</td>
                          <td className="py-3 text-right">{results.analytics.comparison.equalWeight.maxDrawdown}%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Stress Testing */}
                <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur">
                  <h3 className="text-xl font-semibold mb-4">Stress Testing & Risk Analysis</h3>
                  
                  {/* Worst Historical Period */}
                  {results.analytics.stressTest?.worstPeriod && (
                    <div className="mb-6 rounded-xl border border-rose-300/30 bg-rose-500/10 p-4">
                      <h4 className="font-semibold text-rose-200 mb-2">Worst 30-Day Period</h4>
                      <div className="grid gap-2 text-sm text-rose-100">
                        <div className="flex justify-between">
                          <span>Period:</span>
                          <span className="font-semibold">
                            {results.analytics.stressTest.worstPeriod.start} to {results.analytics.stressTest.worstPeriod.end}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Loss:</span>
                          <span className="font-semibold">{results.analytics.stressTest.worstPeriod.loss}%</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Correlation Matrix */}
                  {results.correlationMatrix && (
                    <div className="rounded-xl border border-blue-300/30 bg-blue-500/10 p-4">
                      <h4 className="font-semibold text-blue-200 mb-3">Asset Correlation Matrix</h4>
                      <p className="text-xs text-blue-100 mb-2">
                        Shows how assets move together. Lower correlations = better diversification.
                      </p>
                      <div className="mb-3 rounded-lg border border-purple-300/30 bg-purple-500/10 p-2">
                        <p className="text-xs text-purple-200">
                          <strong>Note:</strong> Correlations calculated using price returns only (excluding dividends). 
                          This provides a more accurate measure of how assets move together, as dividends are predictable 
                          scheduled payments, not market volatility.
                        </p>
                      </div>
                      
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr>
                              <th className="p-2 text-left text-blue-200/80">Asset</th>
                              {results.weights.map((w: any) => (
                                <th key={w.ticker} className="p-2 text-center text-blue-200/80 font-medium">
                                  {w.ticker}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {results.correlationMatrix.map((row: number[], i: number) => (
                              <tr key={i} className="border-t border-blue-300/20">
                                <td className="p-2 font-medium text-blue-100">
                                  {results.weights[i].ticker}
                                </td>
                                {row.map((corr: number, j: number) => (
                                  <td
                                    key={j}
                                    className="p-2 text-center font-semibold"
                                    style={{
                                      backgroundColor: corr > 0 
                                        ? `rgba(239, 68, 68, ${0.3 + Math.abs(corr) * 0.7})` // Red for positive (max 100%)
                                        : `rgba(34, 197, 94, ${0.3 + Math.abs(corr) * 0.7})`, // Green for negative (max 100%)
                                      color: Math.abs(corr) > 0.3 ? 'white' : 'rgba(255,255,255,0.95)'
                                    }}
                                  >
                                    {corr.toFixed(2)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-3 rounded" style={{background: 'rgba(34, 197, 94, 1)'}}></div>
                            <span className="text-blue-100">Negative (diversifies)</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-3 rounded" style={{background: 'rgba(239, 68, 68, 1)'}}></div>
                            <span className="text-blue-100">Positive (moves together)</span>
                          </div>
                        </div>
                        <span className="text-blue-100 font-semibold">
                          Avg Correlation: {results.avgCorrelation}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="rounded-xl border border-white/70 bg-white/10 px-5 py-3 font-semibold backdrop-blur hover:bg-white/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Regenerate
              </button>
              <button
                disabled={saving || !userId || !isLoaded}
                onClick={handleSave}
                className="rounded-xl bg-white text-[var(--bg-end)] px-5 py-3 font-semibold hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Saving..." : "Save to Dashboard"}
              </button>
              {results.analytics?.backtest && (
                <button
                  onClick={async () => {
                    try {
                      await generatePortfolioPDF(results, optimizer, lookbackPeriod, includeDividends);
                    } catch (error) {
                      console.error('Error generating PDF:', error);
                      setError('Failed to generate PDF. Please try again.');
                    }
                  }}
                  className="rounded-xl border border-white/70 bg-white/10 px-5 py-3 font-semibold backdrop-blur hover:bg-white/20"
                >
                  📥 Download Report (PDF)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Back Button */}
        <div className="mt-8">
          <Link
            href={`/portfolio/setup?pid=${pid}`}
            className="inline-flex items-center justify-center rounded-xl border border-white/70 bg-white/10 px-5 py-3 font-semibold backdrop-blur transition hover:bg-white/20"
          >
            Back to Options
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function RiskBudgetingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center text-white">
        Loading...
      </div>
    }>
      <RiskBudgetingPageContent />
    </Suspense>
  );
}
