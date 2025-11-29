"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState, useMemo } from "react";
import {
  getPortfolio,
  updatePortfolio,
  type Portfolio,
  type Holding,
} from "@/lib/portfolioStore";
import PortfolioPerformanceChart from "@/components/PortfolioPerformanceChart";
import PortfolioPerformanceSinceCreation from "@/components/PortfolioPerformanceSinceCreation";
import { generatePortfolioPDF } from "@/components/portfolio/PDFGenerator";

/** Local type for a user-owned position (persisted in Portfolio.currentHoldings). */
type UserPosition = {
  symbol: string;
  shares: number;
  buyPrice: number;
  buyDate: string;
  note?: string;
};

export default function PortfolioDetail() {
  const params = useParams();
  // Auth / routing
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? "";
  const pid = typeof params.id === "string" ? params.id : "";

  // State
  const [p, setP] = useState<Portfolio & { currentHoldings?: UserPosition[] }>();
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [historicalRebalancingData, setHistoricalRebalancingData] = useState<any[]>([]);
  const [loadingRebalancing, setLoadingRebalancing] = useState(false);
  const [sinceCreationRebalancingData, setSinceCreationRebalancingData] = useState<any[]>([]);
  const [sinceCreationMeta, setSinceCreationMeta] = useState<{
    initialPrices?: Record<string, number>;
    initialDate?: string;
    todaysPrices?: Record<string, number>;
    mostRecentDate?: string;
  }>({});
  const [loadingSinceCreation, setLoadingSinceCreation] = useState(false);
  const [sinceCreationNotice, setSinceCreationNotice] = useState<string | null>(null);
  const [currentRiskContributions, setCurrentRiskContributions] = useState<Record<string, number>>({});
  const [downloadingPDF, setDownloadingPDF] = useState(false);

  // Load portfolio
  useEffect(() => {
    if (!isLoaded || !userId || !pid) return;
    setP(getPortfolio(userId, pid) as any);
  }, [isLoaded, userId, pid]);

  // Fetch quotes for proposal + current holdings - once per day after market close
  useEffect(() => {
    const propSyms = (p?.proposalHoldings ?? []).map((h) => String(h.symbol).trim());
    const all = Array.from(new Set([...propSyms])).filter(Boolean);
    if (all.length === 0) return;

    const fetchQuotes = async () => {
      try {
        const res = await fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: all }),
        });
        const data = await res.json();
        setQuotes(data?.quotes || {});
      } catch (error) {
        console.error('Error fetching quotes:', error);
      }
    };

    // Initial fetch on page load
    fetchQuotes();

    // Calculate milliseconds until next 5:00 PM ET (after market close at 4:00 PM ET + 1 hour buffer)
    // 5:00 PM ET = 10:00 PM UTC (22:00) or 9:00 PM UTC (21:00) depending on DST
    const scheduleNextUpdate = () => {
      const now = new Date();
      const nextUpdate = new Date();
      nextUpdate.setUTCHours(22, 0, 0, 0); // 10 PM UTC = 5 PM ET (standard time)
      
      // If we've passed today's update time, schedule for tomorrow
      if (now >= nextUpdate) {
        nextUpdate.setUTCDate(nextUpdate.getUTCDate() + 1);
      }
      
      const msUntilUpdate = nextUpdate.getTime() - now.getTime();
      
      setTimeout(() => {
        fetchQuotes();
        // Schedule next day's update
        scheduleNextUpdate();
      }, msUntilUpdate);
    };

    scheduleNextUpdate();

    // No cleanup needed - timeout handles scheduling
  }, [p?.proposalHoldings]);



  // Proposal stats
  const proposalMove = useMemo(() => {
    if (!p?.proposalHoldings?.length) return null;
    let covered = 0;
    let sum = 0;
    for (const h of p.proposalHoldings) {
      const w = (h.weight ?? 0) / 100;
      const cp = quotes[h.symbol]?.changePercent;
      if (w > 0 && typeof cp === "number") {
        sum += w * (cp / 100);
        covered += w;
      }
    }
    if (covered === 0) return null;
    return { pct: sum * 100, coveragePct: covered * 100 };
  }, [p?.proposalHoldings, quotes]);

  const totalWeight = useMemo(
    () => (p?.proposalHoldings ?? []).reduce((a, h) => a + (h.weight || 0), 0),
    [p]
  );

  // Fetch actual rebalancing data from Yahoo Finance
  useEffect(() => {
    if (!p || !p.proposalHoldings || !p.proposalSummary) return;
    
    // If we have saved backtest results, use them instead of recalculating
    if (p.backtestResults?.rebalanceDates) {
      console.log('✅ Using saved backtest results from portfolio creation');
      console.log('Saved rebalance events:', p.backtestResults.rebalanceDates.length);
      
      // Map saved rebalancing events to display format
      const mappedData = p.backtestResults.rebalanceDates.map((rebalance: any, idx: number) => {
        console.log(`Rebalance #${idx + 1}:`, rebalance);
        
        return {
          date: rebalance.date,
          portfolioValue: rebalance.portfolioValue.toFixed(2),
          weightChanges: rebalance.changes || [],
          qtrReturn: rebalance.quarterlyReturn?.toFixed(2) || "0.00",
          vol: rebalance.volatility?.toFixed(2) || "0.00",
          sharpe: rebalance.sharpe?.toFixed(2) || "0.00",
          pricesAtRebalance: rebalance.pricesAtRebalance || {},
          riskContributions: rebalance.riskContributions || (rebalance.changes || []).reduce((acc: Record<string, number>, change: any) => {
            const ticker = change.symbol || change.ticker;
            if (ticker) {
              acc[ticker] = parseFloat(change.afterWeight);
            }
            return acc;
          }, {} as Record<string, number>),
          // Add dividend data on last rebalance
          dividendCash: idx === p.backtestResults!.rebalanceDates!.length - 1 
            ? p.backtestResults?.dividendCash 
            : undefined,
          shadowPortfolioValue: idx === p.backtestResults!.rebalanceDates!.length - 1
            ? p.backtestResults?.shadowPortfolioValue
            : undefined,
          shadowDividendCash: idx === p.backtestResults!.rebalanceDates!.length - 1
            ? p.backtestResults?.dividendCashIfReinvested
            : undefined,
        };
      });
      
      console.log('Mapped rebalancing data:', mappedData);
      setHistoricalRebalancingData(mappedData);
      setLoadingRebalancing(false);
      return;
    }
    
    // Fallback: calculate from API if no saved results (for old portfolios)
    async function fetchRebalancingData() {
      setLoadingRebalancing(true);
      try {
        const symbols = p!.proposalHoldings!.map(h => h.symbol);
        const weights = p!.proposalHoldings!.map(h => h.weight);
        
        // Use saved backtest dates if available (matches full-analysis exactly)
        // Otherwise fall back to calculating from lookback period
        let startDate: string;
        let endDate: string;
        
        if (p!.backtestStartDate && p!.backtestEndDate) {
          // Use exact dates from when portfolio was generated
          startDate = p!.backtestStartDate;
          endDate = p!.backtestEndDate;
          console.log('📅 Using saved backtest dates:', startDate, 'to', endDate);
        } else {
          // Fallback: calculate from lookback period (for old portfolios)
          const lookback = p!.proposalSummary?.lookbackPeriod || '5y';
          const today = new Date();
          const start = new Date();
          
          switch(lookback) {
            case '1y':
              start.setFullYear(today.getFullYear() - 1);
              break;
            case '3y':
              start.setFullYear(today.getFullYear() - 3);
              break;
            case '5y':
            default:
              start.setFullYear(today.getFullYear() - 5);
              break;
          }
          
          startDate = start.toISOString().split('T')[0];
          endDate = today.toISOString().split('T')[0];
          console.log('📅 Calculated dates from lookback:', startDate, 'to', endDate);
        }
        
        const response = await fetch('/api/rebalancing-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbols,
            weights,
            startDate,
            endDate
          })
        });
        
        if (!response.ok) throw new Error('Failed to fetch rebalancing data');
        
        const data = await response.json();
        setHistoricalRebalancingData(data.rebalancingData || []);
      } catch (error) {
        console.error('Error fetching rebalancing data:', error);
      } finally {
        setLoadingRebalancing(false);
      }
    }
    
    fetchRebalancingData();
  }, [p?.id]);

  // Fetch rebalancing data since portfolio creation
  useEffect(() => {
    if (!p || !p.proposalHoldings) return;
    
    async function fetchSinceCreationData() {
      setLoadingSinceCreation(true);
      setSinceCreationNotice(null);
      try {
        const symbols = p!.proposalHoldings!.map(h => h.symbol);
        const weights = p!.proposalHoldings!.map(h => h.weight);
        const lookbackYears = (() => {
          const lb = p!.proposalSummary?.lookbackPeriod;
          if (typeof lb === 'string') {
            const match = lb.match(/(\d+)/);
            if (match) return parseInt(match[1], 10);
          }
          return 5;
        })();
        
        // Get creation date and today
        const creationDate = new Date(p!.createdAt);
        const today = new Date();
        
        const response = await fetch('/api/rebalancing-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbols,
            weights,
            startDate: creationDate.toISOString().split('T')[0],
            endDate: today.toISOString().split('T')[0],
            includeCorrelations: true, // Request correlation data
            lookbackPeriodYears: lookbackYears,
          })
        });
        
        if (!response.ok) throw new Error('Failed to fetch since creation data');

        const data = await response.json();
        console.log('Rebalancing data received:', data); // Debug log
        
        if (data?.insufficientHistory) {
          setSinceCreationNotice(
            data.message || 'Performance since creation will populate after the first full trading day.'
          );
          setSinceCreationRebalancingData([]);
          setSinceCreationMeta({
            initialPrices: data.initialPrices || {},
            initialDate: data.initialDate,
            todaysPrices: data.todaysPrices || {},
            mostRecentDate: data.mostRecentDate,
          });
          setCurrentRiskContributions({});
          return;
        } else {
          setSinceCreationNotice(null);
        }

        setSinceCreationRebalancingData(data.rebalancingData || []);
        setSinceCreationMeta({
          initialPrices: data.initialPrices,
          initialDate: data.initialDate,
          todaysPrices: data.todaysPrices,
          mostRecentDate: data.mostRecentDate,
        });
        if (data.currentRiskContributions) {
          setCurrentRiskContributions(data.currentRiskContributions);
        }
      } catch (error) {
        console.error('Error fetching since creation data:', error);
        setSinceCreationNotice('Unable to load performance since creation yet. Please try again soon.');
      } finally {
        setLoadingSinceCreation(false);
      }
    }
    
    fetchSinceCreationData();
  }, [p?.id]);

  // Calculate current risk contributions based on live market data
  useEffect(() => {
    if (!p?.proposalHoldings || !quotes || Object.keys(quotes).length === 0) return;
    
    // If we already have drifted risk contributions from the since-creation API,
    // avoid overriding them with approximations.
    if (Object.keys(currentRiskContributions).length > 0) return;
    
    // NEW LOGIC: Use calculate drifted risk contributions from backtest if available
    // We cast to `any` because `Portfolio` type might not have been updated in your store file yet
    const results = p.backtestResults as any;
    
    if (results?.currentRiskContributions) {
      console.log('✅ Using calculated Drifted Risk Contributions from Backtest:', results.currentRiskContributions);
      setCurrentRiskContributions(results.currentRiskContributions);
      return;
    } 
    
    // FALLBACK: Use notes or weights
    const riskContribs: Record<string, number> = {};
    let hasAllRiskContribs = true;
    
    p.proposalHoldings.forEach((h: any) => {
      // Note format: "US Equities • Risk Contribution: 25.00%"
      const match = h.note?.match(/Risk Contribution:\s*([\d.]+)%/);
      if (match) {
        riskContribs[h.symbol] = parseFloat(match[1]);
      } else {
        hasAllRiskContribs = false;
      }
    });
    
    if (hasAllRiskContribs && Object.keys(riskContribs).length > 0) {
      console.log('✅ Using risk contributions from portfolio note field:', riskContribs);
      setCurrentRiskContributions(riskContribs);
    } else {
      // Fallback: Use target weights as approximation if no saved risk contributions
      console.log('⚠️ No saved risk contributions found, using weights as approximation');
      const fallback: Record<string, number> = {};
      p.proposalHoldings.forEach((h: any) => {
        fallback[h.symbol] = h.weight;
      });
      setCurrentRiskContributions(fallback);
    }
  }, [p?.proposalHoldings, quotes, sinceCreationRebalancingData, p?.backtestResults, currentRiskContributions]);

  const getClosingPrice = (symbol: string): number => {
    const close = sinceCreationMeta.todaysPrices?.[symbol];
    if (typeof close === "number" && !Number.isNaN(close)) {
      return close;
    }
    const quote = quotes[symbol];
    return quote?.price ?? 0;
  };

  // Early returns AFTER all hooks
  if (!isLoaded) return null;
  if (!p) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="rounded-2xl border bg-white p-6">
          <p className="mb-4">Portfolio not found.</p>
          <Link href="/dashboard" className="rounded-xl border px-4 py-2 hover:shadow">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const hasProposal = Array.isArray(p.proposalHoldings) && p.proposalHoldings.length > 0;
  const summary = p.proposalSummary;
  const isRiskBudgeting =
    typeof summary === "object" &&
    typeof summary?.methodology === "string" &&
    /risk/i.test(summary.methodology);

  // ES metrics (if present). Non-intrusive: computed but UI hidden when absent.
  const esMetrics =
    summary &&
    typeof summary === "object" &&
    summary.metrics &&
    summary.metrics.ES
      ? {
          ES: summary.metrics.ES as string,
          H: summary.metrics.H as string | undefined,
          D: summary.metrics.D as string | undefined,
          RCshare:
            (summary.weights?.map((w: any) => ({
              ticker: w.ticker,
              rcShare: w.riskContribution,
            })) as { ticker: string; rcShare: string }[]) || [],
        }
      : undefined;
  const optimizerMode: "erc" | "es" =
    summary?.methodology?.toLowerCase().includes("shortfall") ? "es" : "erc";
  const lookbackLabel = (summary?.lookbackPeriod as "1y" | "3y" | "5y" | "3m") || "5y";
  const backtestResultsData = p.backtestResults;
  const sinceCreationLatest = sinceCreationRebalancingData.length > 0
    ? sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1]
    : null;
  const sinceCreationReturnPct = sinceCreationLatest
    ? ((parseFloat(sinceCreationLatest.portfolioValue) - 10000) / 10000) * 100
    : undefined;

  const handleDownloadReport = async () => {
    if (!p || !(p.proposalHoldings?.length)) return;
    try {
      setDownloadingPDF(true);
      const weights = (p.proposalHoldings ?? []).map((holding) => {
        const nameFromNote = holding.note?.split(" • ")[0];
        return {
          name: nameFromNote || holding.symbol,
          ticker: holding.symbol,
          weight: holding.weight,
          riskContribution: currentRiskContributions[holding.symbol],
        };
      });

  const pdfResults = {
    asOf: summary?.dataAsOf || sinceCreationMeta.mostRecentDate,
    weights,
        metrics: summary
          ? {
              expectedReturn: summary.expectedReturn,
              portfolioVolatility: summary.portfolioVolatility,
              sharpeRatio: summary.sharpeRatio,
              maxDrawdown: summary.maxDrawdown,
            }
          : undefined,
        correlationMatrix: summary?.correlationMatrix,
        avgCorrelation: summary?.avgCorrelation,
        volatilityTargeting: summary?.volatilityTargeting,
        analytics: backtestResultsData
          ? {
              backtest: {
                totalReturn: backtestResultsData.totalReturn,
                annualizedReturn: backtestResultsData.annualizedReturn,
                annualizedVolatility: backtestResultsData.annualizedVolatility,
                sharpeRatio: backtestResultsData.sharpeRatio,
                maxDrawdown: backtestResultsData.maxDrawdown,
                finalValue: backtestResultsData.finalValue,
                rebalanceCount: backtestResultsData.rebalanceDates?.length,
                dividendCash: backtestResultsData.dividendCash,
                dividendCashIfReinvested: backtestResultsData.dividendCashIfReinvested,
                dates: backtestResultsData.dates,
                maxDrawdownPeriod: backtestResultsData.maxDrawdownPeriod,
              },
            }
          : undefined,
    livePerformance: sinceCreationReturnPct !== undefined
      ? {
          totalReturnPct: sinceCreationReturnPct,
          finalValue: sinceCreationLatest ? parseFloat(sinceCreationLatest.portfolioValue) : undefined,
          startDate: sinceCreationMeta.initialDate || summary?.dataAsOf,
          endDate: sinceCreationMeta.mostRecentDate,
        }
      : undefined,
    currentPerformanceSeries: (() => {
      const series: { date?: string; value: number }[] = [];
      const creationDate = sinceCreationMeta.initialDate || summary?.dataAsOf;
      if (creationDate) {
        series.push({ date: creationDate, value: 10000 });
      }
      if (sinceCreationRebalancingData.length > 0) {
        sinceCreationRebalancingData.forEach((rebalance: any) => {
          const value = parseFloat(rebalance.portfolioValue);
          if (!Number.isNaN(value)) {
            series.push({ date: rebalance.date, value });
          }
        });
      }
      if (series.length === 0 && backtestResultsData?.portfolioValues?.length) {
        backtestResultsData.portfolioValues.forEach((value: number, idx: number) => {
          series.push({
            date: backtestResultsData.dates?.[idx],
            value,
          });
        });
      }
      return series.length > 1 ? series : undefined;
    })(),
    includeDividends: Boolean(backtestResultsData?.dividendCashIfReinvested),
  };

      await generatePortfolioPDF(
        pdfResults as any,
        optimizerMode,
        lookbackLabel,
        Boolean(backtestResultsData?.dividendCashIfReinvested)
      );
    } catch (error) {
      console.error("Failed to generate dashboard PDF:", error);
    } finally {
      setDownloadingPDF(false);
    }
  };

  // Render
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-4xl font-bold text-white drop-shadow-lg">
              {p.name}
            </h1>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-xl border border-slate-600/50 bg-slate-700/50 px-5 py-3 font-semibold backdrop-blur transition hover:bg-slate-600/60"
            >
              ← Back to Dashboard
            </Link>
          </div>
          <p className="text-lg text-slate-200 font-medium">
            Created {new Date(p.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Portfolio Summary */}
        {p.proposalSummary && (
          <div className="mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-4">Portfolio Summary</h2>
            
            {isRiskBudgeting ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                  <MetricBox label="Strategy" value={summary.methodology || "Risk Budgeting"} />
                  <MetricBox 
                    label="Annual Volatility" 
                    value={p.backtestResults?.annualizedVolatility 
                      ? `${p.backtestResults.annualizedVolatility.toFixed(2)}%` 
                      : summary.portfolioVolatility} 
                  />
                  <MetricBox 
                    label="Sharpe Ratio" 
                    value={p.backtestResults?.sharpeRatio 
                      ? p.backtestResults.sharpeRatio.toFixed(2) 
                      : summary.sharpeRatio} 
                  />
                  <MetricBox 
                    label="Annualized Return" 
                    value={p.backtestResults?.annualizedReturn 
                      ? `${p.backtestResults.annualizedReturn.toFixed(2)}%` 
                      : summary.expectedReturn} 
                  />
                  <MetricBox 
                    label="Max Drawdown" 
                    value={p.backtestResults?.maxDrawdown 
                      ? `${p.backtestResults.maxDrawdown.toFixed(2)}%` 
                      : summary.maxDrawdown} 
                  />
                  <MetricBox label="Lookback Period" value={
                    summary.lookbackPeriod === '1y' ? '1 Year' : 
                    summary.lookbackPeriod === '3y' ? '3 Years' : 
                    '5 Years'
                  } />
                  <MetricBox label="Optimization Date" value={summary.dataAsOf} />
                  <MetricBox label="Asset Count" value={p.proposalHoldings?.length.toString() || '0'} />
                </div>
                <div className="mb-6 flex flex-wrap gap-3">
                  <button
                    onClick={handleDownloadReport}
                    disabled={downloadingPDF || !(p.proposalHoldings?.length)}
                    className="rounded-xl border border-white/40 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {downloadingPDF ? "Preparing PDF..." : "📥 Download Portfolio PDF"}
                  </button>
                </div>

                {/* ES / RC* / H / D block (non-intrusive; only renders when esMetrics present) */}
                {esMetrics && (
                  <div className="mb-6 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-fuchsia-200"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z" />
                        </svg>
                        <span className="text-sm font-semibold text-fuchsia-100">
                          Expected Shortfall Risk-Budgeting Metrics
                        </span>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <div className="text-right">
                          <div className="text-fuchsia-200/80">ES (97.5% Tail Risk)</div>
                          <div className="text-lg font-bold text-fuchsia-50">
                            {Number(esMetrics.ES).toFixed(4)}
                          </div>
                        </div>
                        {esMetrics.H && (
                          <div className="text-right">
                            <div className="text-fuchsia-200/80">Entropy H(x)</div>
                            <div className="text-lg font-bold text-fuchsia-50">
                              {Number(esMetrics.H).toFixed(4)}
                            </div>
                          </div>
                        )}
                        {esMetrics.D && (
                          <div className="text-right">
                            <div className="text-fuchsia-200/80">Effective N (D)</div>
                            <div className="text-lg font-bold text-fuchsia-50">
                              {Number(esMetrics.D).toFixed(2)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {esMetrics.RCshare.length > 0 && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {esMetrics.RCshare.map((rc) => (
                          <div
                            key={rc.ticker}
                            className="flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2"
                          >
                            <span className="text-xs font-medium text-slate-100">
                              {rc.ticker}
                            </span>
                            <span className="text-xs text-fuchsia-100">
                              RC*:&nbsp;
                              <span className="font-semibold">
                                {Number(rc.rcShare).toFixed(2)}%
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="mt-3 text-[11px] text-fuchsia-100/80">
                      ES is computed from daily total returns with a Gaussian approximation at the
                      97.5% confidence level, using a shrinkage covariance matrix. RC* shows each
                      asset&apos;s share of total Expected Shortfall. H(x) and D(x)=e^H measure
                      diversification: higher D means more evenly-spread risk.
                    </p>
                  </div>
                )}

                {/* Info: Backtest vs Forward Estimates */}
                {p.backtestResults && (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-blue-300" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-semibold text-blue-200">Historical Performance</span>
                    </div>
                    <p className="text-xs text-blue-200/80">
                      These metrics show <strong>actual historical performance</strong> from {p.backtestStartDate} to {p.backtestEndDate} based on real market data. 
                      These are the results your portfolio would have achieved if you had invested during this period.
                    </p>
                  </div>
                )}
                
                {/* Optimization Details */}
                {summary.optimization && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      {summary.optimization.converged ? (
                        <>
                          <svg className="w-5 h-5 text-emerald-300" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm font-semibold text-emerald-200">Optimization Successful</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5 text-amber-300" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm font-semibold text-amber-200">Optimization Completed</span>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-emerald-200/80">
                      {summary.optimization.converged 
                        ? `The algorithm converged after ${summary.optimization.iterations} iterations, finding the optimal Equal Risk Contribution weights where each asset contributes equally to portfolio risk.`
                        : `Optimization completed in ${summary.optimization.iterations} iterations.`
                      }
                    </p>
                  </div>
                )}
              </>
            ) : typeof summary === "string" ? (
              <p className="text-slate-200 leading-relaxed">{summary}</p>
            ) : (
              <div className="space-y-4 text-slate-200">
                {summary["Economic Thesis"] && (
                  <div>
                    <h3 className="font-semibold text-white">Economic Thesis</h3>
                    <p>{summary["Economic Thesis"]}</p>
                  </div>
                )}
                {summary["Portfolio Logic"] && (
                  <div>
                    <h3 className="font-semibold text-white">Portfolio Logic</h3>
                    <p>{summary["Portfolio Logic"]}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Dividend Information */}
        {p.proposalSummary && (
          <div className="mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Return Calculation</h2>
                <p className="text-sm text-slate-300 mt-1">
                  All returns include dividend yields (automatically reinvested)
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-sm text-emerald-100">
                <strong>Dividends Matter:</strong> ETFs like SPY (~1.5% yield), LQD (~3-4% yield), and TLT (~2-3% yield) 
                pay regular dividends. Dividends are automatically reinvested to buy additional shares. 
                Over 5 years, this can add 10-20% to total returns. All performance charts and metrics on this page 
                include dividend reinvestment for accurate performance measurement.
              </p>
            </div>
          </div>
        )}

        {/* Portfolio Holdings */}
        {p.proposalHoldings && p.proposalHoldings.length > 0 && (
          <>
            {/* Historical Performance Chart */}
            <div className="mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
              <h2 className="text-2xl font-bold text-white mb-4">Historical Performance</h2>
              <PortfolioPerformanceChart 
                holdings={p.proposalHoldings} 
                lookbackPeriod={p.proposalSummary?.lookbackPeriod || '5y'} 
                createdAt={new Date(p.createdAt).toISOString()}
                rebalancingDates={historicalRebalancingData.map(r => r.date)}
                savedBacktestData={p.backtestResults ? {
                  portfolioValues: p.backtestResults.portfolioValues,
                  dates: p.backtestResults.dates
                } : undefined}
                benchmarkSymbol="SPY"
              />

              {/* Historical Rebalancing Timeline - Directly under chart */}
              {loadingRebalancing ? (
                <div className="mt-6 pt-6 border-t border-slate-600/30 text-center">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-400 border-t-purple-500"></div>
                  <p className="text-sm text-slate-300 mt-2">Loading rebalancing data...</p>
                </div>
              ) : historicalRebalancingData.length > 0 && (
                <div className="mt-6 pt-6 border-t border-slate-600/30">
                  <h4 className="font-semibold text-white mb-3">Rebalancing Timeline</h4>
                  <p className="text-sm text-slate-300 mb-4">
                    Portfolio was rebalanced {historicalRebalancingData.length} times (quarterly) to maintain risk balance. 
                    Each rebalance incurred 0.1% transaction costs.
                  </p>
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {historicalRebalancingData.map((rebalance, idx) => (
                      <div key={idx} className="rounded-lg bg-slate-700/30 border border-slate-500/30 p-3">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold text-white">
                            Rebalance #{idx + 1} - {new Date(rebalance.date).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'short', 
                              day: '2-digit' 
                            })}
                          </span>
                          <span className="text-xs text-slate-400">
                            Portfolio: ${rebalance.portfolioValue}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          {/* Column 1 & 2: Weight Changes */}
                          <div className="col-span-2 grid grid-cols-2 gap-x-4 gap-y-1">
                            {rebalance.weightChanges.slice(0, 4).map((change: any, hIdx: number) => (
                              <div key={hIdx} className="flex items-center gap-1.5 text-xs">
                                <span className="text-slate-300 font-medium min-w-[45px]">{change.ticker || change.symbol}:</span>
                                <span className="text-slate-100">
                                  {change.beforeWeight}% → {change.afterWeight}%
                                </span>
                                <span className={`text-xs font-bold ${
                                  parseFloat(change.drift) > 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}>
                                  ({parseFloat(change.drift) > 0 ? '+' : ''}{change.drift}%)
                                </span>
                              </div>
                            ))}
                          </div>
                          
                          {/* Column 3: Portfolio Metrics */}
                          <div className="border-l border-slate-600/30 pl-4 space-y-1">
                            <div className="text-xs">
                              <span className="text-slate-400">Qtr Return:</span>{' '}
                              <span className={`font-semibold ${
                                parseFloat(rebalance.qtrReturn) >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {parseFloat(rebalance.qtrReturn) > 0 ? '+' : ''}{rebalance.qtrReturn}%
                              </span>
                            </div>
                            <div className="text-xs">
                              <span className="text-slate-400">Vol:</span>{' '}
                              <span className="text-slate-100 font-semibold">{rebalance.vol}%</span>
                            </div>
                            <div className="text-xs">
                              <span className="text-slate-400">Sharpe:</span>{' '}
                              <span className="text-slate-100 font-semibold">{rebalance.sharpe}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Performance Since Creation Chart */}
            <div className="mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
              <h2 className="text-2xl font-bold text-white mb-4">Performance Since Portfolio Creation</h2>
              <PortfolioPerformanceSinceCreation 
                holdings={p.proposalHoldings} 
                createdAt={new Date(p.createdAt).toISOString()}
                rebalancingDates={(() => {
                  // Generate quarterly rebalancing since creation for this chart
                  const dates: string[] = [];
                  const startDate = new Date(p.createdAt);
                  const today = new Date();
                  let currentDate = new Date(startDate);
                  currentDate.setMonth(Math.ceil((currentDate.getMonth() + 1) / 3) * 3);
                  currentDate.setDate(1);
                  while (currentDate <= today) {
                    dates.push(currentDate.toISOString());
                    currentDate.setMonth(currentDate.getMonth() + 3);
                  }
                  return dates;
                })()}
                rebalancingFrequency={p.rebalancingFrequency || 'quarterly'}
                benchmarkSymbol="SPY"
              />
            </div>

            {sinceCreationNotice && (
              <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 backdrop-blur-xl shadow-2xl">
                <p className="text-sm text-amber-50">{sinceCreationNotice}</p>
              </div>
            )}

            {/* Opportunity Cost Analysis */}
            <div className="mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
              <h2 className="text-2xl font-bold text-white mb-4">Dividend Reinvestment Analysis</h2>
              
              {sinceCreationRebalancingData.length === 0 ? (
                <div className="text-center py-12">
                  <div className="mb-4">
                    <svg className="w-16 h-16 mx-auto text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Analysis Pending</h3>
                  <p className="text-slate-300 mb-4">
                    Dividend analysis will be available after the first quarterly rebalance
                  </p>
                  <p className="text-sm text-slate-400">
                    Your portfolio rebalances quarterly. The first rebalance will occur on the first day of the next quarter,
                    at which point you will see detailed dividend reinvestment analysis and comparison data.
                  </p>
                </div>
              ) : (
                <>
                  {sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].dividendCash ? (
                <div className="mb-6 p-4 rounded-xl border border-emerald-300/30 bg-emerald-500/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-emerald-300" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-semibold text-emerald-100">
                        💰 Total Dividends Received & Reinvested:
                      </span>
                    </div>
                    <span className="text-lg font-bold text-emerald-50">
                      ${sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].dividendCash?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-200/80 mt-2">
                    These dividends were automatically reinvested to buy additional shares, compounding your returns over time.
                  </p>
                </div>
                ) : (
                  <p className="text-slate-400 mb-4">No dividend data available yet</p>
                )}

                {/* Comparison: With vs Without Reinvestment */}
                {sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowPortfolioValue && (
                  <div className="p-5 rounded-xl border-2 border-amber-300/40 bg-gradient-to-br from-amber-500/15 to-orange-500/10">
                    <h4 className="text-base font-bold text-amber-100 mb-3 flex items-center gap-2">
                      <span>⚡</span> Opportunity Cost Analysis
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {/* Current Strategy (With Reinvestment) */}
                      <div className="rounded-lg bg-emerald-900/40 p-4 border-2 border-emerald-400/50 shadow-lg">
                        <div className="text-xs text-emerald-300/80 mb-1 flex items-center gap-1.5">
                          <span>✅ With Reinvestment</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/30 border border-emerald-400/40">Current</span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <div className="text-xs text-emerald-300/80">Portfolio Value:</div>
                            <div className="text-xl font-bold text-emerald-50">
                              ${parseFloat(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].portfolioValue).toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-emerald-300/80">Dividends reinvested:</div>
                            <div className="text-lg font-semibold text-emerald-100">
                              ${sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].dividendCash?.toFixed(2) || '0.00'}
                            </div>
                          </div>
                          <div className="pt-2 border-t border-emerald-500/30">
                            <div className="text-xs text-emerald-300/80">Total Value:</div>
                            <div className="text-2xl font-bold text-emerald-50">
                              ${parseFloat(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].portfolioValue).toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-emerald-300/80">Total Return:</div>
                            <div className="text-lg font-semibold text-emerald-100">
                              {((parseFloat(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].portfolioValue) - 10000) / 10000 * 100).toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Without Reinvestment (Shadow Portfolio) */}
                      <div className="rounded-lg bg-slate-800/60 p-4 border border-slate-600/40">
                        <div className="text-xs text-slate-300 mb-1">❌ Without Reinvestment</div>
                        <div className="space-y-2">
                          <div>
                            <div className="text-xs text-slate-400">Portfolio Value:</div>
                            <div className="text-xl font-bold text-white">
                              ${(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowPortfolioValue - sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowDividendCash).toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-400">+ Cash (sitting idle):</div>
                            <div className="text-lg font-semibold text-slate-200">
                              ${sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowDividendCash?.toFixed(2) || '0.00'}
                            </div>
                          </div>
                          <div className="pt-2 border-t border-slate-600/50">
                            <div className="text-xs text-slate-400">Total Value:</div>
                            <div className="text-2xl font-bold text-amber-200">
                              ${sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowPortfolioValue?.toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-400">Total Return:</div>
                            <div className="text-lg font-semibold text-slate-200">
                              {((sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowPortfolioValue - 10000) / 10000 * 100).toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Impact Summary */}
                    <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-400/30">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-red-200">
                          {(parseFloat(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].portfolioValue) - sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowPortfolioValue) > 0 
                            ? "✅ Benefit of Reinvestment:" 
                            : "⚠️ Market Timing Effect:"}
                        </span>
                        <span className="text-xl font-bold text-red-100">
                          ${Math.abs(parseFloat(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].portfolioValue) - sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowPortfolioValue).toFixed(2)}
                        </span>
                      </div>
                      {(parseFloat(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].portfolioValue) - sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].shadowPortfolioValue) > 0 ? (
                        <p className="text-xs text-emerald-200/80 mt-1">
                          Dividend reinvestment added value through compounding returns.
                        </p>
                      ) : (
                        <div className="text-xs text-amber-200/90 mt-2 space-y-1">
                          <p className="font-semibold">
                            📊 Sequence-of-Returns Risk: In this period, holding cash actually preserved more value.
                          </p>
                          <p>
                            When prices declined after dividend payments, reinvesting bought shares that subsequently lost value. 
                            This is typical in bear markets. Over longer periods and full market cycles, 
                            reinvestment typically wins due to compounding, but timing matters!
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                </>
              )}
              </div>


{/* Portfolio Allocation Pie Charts - Side by Side */}
<div className="mb-6 grid gap-6 lg:grid-cols-2">
  {/* LEFT: Portfolio Allocation */}
  <div className="rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
    <h2 className="text-2xl font-bold text-white mb-2">Current Target Allocation</h2>
    {(() => {
      // Determine which weights to show:
      // If there's a rebalance AFTER portfolio creation, use that
      // Otherwise, use the initial creation weights
      const lastRebalance = sinceCreationRebalancingData.length > 0 
        ? sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1] 
        : null;
      
      const creationDate = new Date(p.createdAt);
      const lastRebalanceDate = lastRebalance ? new Date(lastRebalance.date) : null;
      
      // Use rebalance weights if a rebalance happened AFTER creation
      const useRebalanceWeights = lastRebalanceDate && lastRebalanceDate > creationDate;
      
      if (useRebalanceWeights && lastRebalance) {
        // Portfolio has been rebalanced since creation - show rebalance weights
        return (
          <>
            <p className="text-sm text-slate-300 mb-4">
              Last rebalanced: {new Date(lastRebalance.date).toLocaleDateString()} 
              (weights recalculated with updated 5-year data)
            </p>
            <AllocationPieChart weights={lastRebalance.weightChanges.map((wc: any) => ({
              ticker: wc.ticker || wc.symbol,
              name: wc.ticker || wc.symbol,
              weight: parseFloat(wc.afterWeight).toFixed(2),
              riskContribution: parseFloat(wc.afterWeight).toFixed(2)
            }))} />
            <div className="mt-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <p className="text-xs text-emerald-200">
                <strong>Quarterly Rebalancing:</strong> On {new Date(lastRebalance.date).toLocaleDateString()}, 
                your portfolio was automatically rebalanced using the most recent 5-year volatility and correlation data. 
                The ERC optimizer recalculated weights to ensure each asset contributes equally to risk. 
                Next rebalance: {(() => {
                  const next = new Date(lastRebalance.date);
                  next.setMonth(next.getMonth() + 3);
                  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                })()}.
              </p>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              ERC ensures each asset resumes an equal risk contribution immediately after every rebalance.
            </p>
          </>
        );
      } else {
        // No rebalance since creation - show initial weights
        return (
          <>
            <p className="text-sm text-slate-300 mb-4">
              Optimized on {creationDate.toLocaleDateString()} using 5-year historical data
            </p>
            <AllocationPieChart weights={p.proposalHoldings.map(h => ({
              ticker: h.symbol,
              name: h.symbol,
              weight: h.weight.toString(),
              riskContribution: h.weight.toString()
            }))} />
            <div className="mt-4 p-3 rounded-lg border border-blue-500/30 bg-blue-500/10">
              <p className="text-xs text-blue-200">
                <strong>Initial Allocation:</strong> Your portfolio was optimized on {creationDate.toLocaleDateString()} using 
                Equal Risk Contribution (ERC) with 5-year volatility and correlation data. Each asset contributes equally 
                to portfolio risk. Your first automatic rebalance will occur on {(() => {
                  const next = new Date(creationDate);
                  // Find next quarter start (Jan 1, Apr 1, Jul 1, Oct 1)
                  const month = next.getMonth();
                  const quarterMonth = Math.ceil((month + 1) / 3) * 3; // Next quarter
                  next.setMonth(quarterMonth);
                  next.setDate(1);
                  if (next <= creationDate) {
                    next.setMonth(next.getMonth() + 3); // Move to next quarter if same/past
                  }
                  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                })()}, when weights will be recalculated with updated market data.
              </p>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              ERC starts every holding at the same risk contribution, so each sleeve carried an equal share
              of portfolio volatility on day one.
            </p>
          </>
        );
      }
    })()}
  </div>

  {/* RIGHT: Market Drift */}
  <div className="rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
    <h2 className="text-2xl font-bold text-white mb-2">Current Market Drift</h2>
    <p className="text-sm text-slate-300 mb-4">Live weights based on today's prices</p>
    {(() => {
      // Get target weights and prices from last rebalance or initial
      const lastRebalanceData = sinceCreationRebalancingData.length > 0
        ? sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1]
        : null;
      
      const targetWeights = lastRebalanceData
        ? lastRebalanceData.weightChanges.map((wc: any) => ({
            symbol: wc.ticker || wc.symbol,
            weight: parseFloat(wc.afterWeight)
          }))
        : p.proposalHoldings?.map((h: any) => ({
            symbol: h.symbol,
            weight: h.weight
          })) || [];
      
      // For brand new portfolios (no rebalance history yet), suppress drift until we have at least
      // one official market close after creation so that we don't show noise from intraday pricing.
      const hasPostCreationClose = (() => {
        if (lastRebalanceData) return true;
        if (!sinceCreationMeta?.initialDate || !sinceCreationMeta?.mostRecentDate) return false;
        const initial = new Date(sinceCreationMeta.initialDate);
        const latest = new Date(sinceCreationMeta.mostRecentDate);
        return latest.getTime() > initial.getTime();
      })();

      if (!lastRebalanceData && !hasPostCreationClose) {
        const initialWeights = (p.proposalHoldings ?? []).map((h: any) => ({
          ticker: h.symbol,
          name: h.symbol,
          weight: Number(h.weight).toFixed(2),
          riskContribution: Number(h.weight).toFixed(2),
        }));

        return (
          <>
            <AllocationPieChart weights={initialWeights} />
            <div className="mt-3 space-y-1">
              {initialWeights.map((w: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{w.ticker}:</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-100">{w.weight}%</span>
                    <span className="text-slate-400">(0.00%)</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-lg border border-blue-500/30 bg-blue-500/10">
              <p className="text-xs text-blue-200">
                First-day safeguard: we need a full market close before showing drift. 
                After tonight's official close, this card will update automatically using the
                previous day's closing prices.
              </p>
            </div>
          </>
        );
      }
      
      // Get historical prices from last rebalance or initial creation snapshot
      const basePrices: Record<string, number> = lastRebalanceData?.pricesAtRebalance
        || sinceCreationMeta.initialPrices
        || {};
      
      // Calculate ACCURATE current weights using real historical prices
      const currentWeights = targetWeights.map((tw: any) => {
        const currentPrice = getClosingPrice(tw.symbol);
        const rebalancePrice = basePrices[tw.symbol] || currentPrice || 0;
        
        // Calculate shares bought at last rebalance
        const initialValue = 10000 * (tw.weight / 100);
        const shares = rebalancePrice > 0 ? initialValue / rebalancePrice : 0;
        
        // Value those shares at TODAY's price
        const currentValue = shares * currentPrice;
        
        return {
          ticker: tw.symbol,
          name: tw.symbol,
          value: currentValue,
          targetWeight: tw.weight,
          rebalancePrice,
          currentPrice
        };
      });
      
      const totalValue = currentWeights.reduce((sum: number, w: any) => sum + w.value, 0);
      
      const weightsWithPercentages = currentWeights.map((w: any) => ({
        ...w,
        weight: totalValue > 0 ? ((w.value / totalValue) * 100).toFixed(2) : w.targetWeight.toFixed(2),
        riskContribution: totalValue > 0 ? ((w.value / totalValue) * 100).toFixed(2) : w.targetWeight.toFixed(2),
        drift: totalValue > 0 ? (((w.value / totalValue) * 100) - w.targetWeight).toFixed(2) : '0.00'
      }));
      
      return (
        <>
          <AllocationPieChart weights={weightsWithPercentages} />
          <div className="mt-3 space-y-1">
            {weightsWithPercentages.map((w: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{w.ticker}:</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-100">{w.weight}%</span>
                  <span className={`font-semibold ${
                    parseFloat(w.drift) > 0 ? 'text-emerald-400' : parseFloat(w.drift) < 0 ? 'text-red-400' : 'text-slate-300'
                  }`}>
                    ({parseFloat(w.drift) > 0 ? '+' : ''}{w.drift}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      );
    })()}
    <div className="mt-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
      <p className="text-xs text-amber-200">
        <strong>Official close drift:</strong> We recalculate these weights each evening using the most recent
        market close. Compare them with the target allocation to spot how the portfolio moved during the last
        session. At the next quarterly rebalance, the system will trim overweight positions and add to the
        underweights to restore equal risk.
      </p>
    </div>
  </div>
</div>            {/* Holdings Table */}
            <div className="rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
              <h2 className="text-2xl font-bold text-white mb-4">Current Portfolio Holdings</h2>
              {sinceCreationRebalancingData.length > 0 ? (
                <p className="text-sm text-slate-300 mb-4">
                  Last rebalanced: {new Date(sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].date).toLocaleDateString()} • 
                  Portfolio Value: ${sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1].portfolioValue} • 
                  Updates daily after market close
                </p>
              ) : (
                <p className="text-sm text-slate-300 mb-4">
                  Initial allocation (created {new Date(p.createdAt).toLocaleDateString()}) • Updates daily after market close
                </p>
              )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-600/30">
                    <th className="py-3 pr-4 font-semibold">Symbol</th>
                    <th className="py-3 pr-4 text-right font-semibold">Target Weight</th>
                    <th className="py-3 pr-4 text-right font-semibold">Current Weight</th>
                    <th className="py-3 pr-4 text-right font-semibold">Drift</th>
                    <th className="py-3 pr-4 text-right font-semibold">Return</th>
                    <th className="py-3 pr-4 text-right font-semibold">Risk Contrib.</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Get last rebalance data
                    const lastRebalanceData = sinceCreationRebalancingData.length > 0
                      ? sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1]
                      : null;
                    
                    const targetAllocations = lastRebalanceData
                      ? lastRebalanceData.weightChanges.map((wc: any) => ({
                          symbol: wc.ticker || wc.symbol,
                          weight: parseFloat(wc.afterWeight)
                        }))
                      : p.proposalHoldings?.map((h: any) => ({
                          symbol: h.symbol,
                          weight: h.weight
                        })) || [];
                    
                    // Latest recommended target weights (what should be done today)
                    const todaysTargetMap = (p.proposalHoldings && p.proposalHoldings.length > 0
                      ? p.proposalHoldings
                      : targetAllocations).reduce((acc: Record<string, number>, item: any) => {
                        const symbol = item.symbol || item.ticker;
                        const weightValue = typeof item.weight === "number"
                          ? item.weight
                          : typeof item.targetWeight === "number"
                            ? item.targetWeight
                            : 0;
                        if (symbol) {
                          acc[symbol] = weightValue;
                        }
                        return acc;
                      }, {} as Record<string, number>);
                    
                    const pricesAtRebalance: Record<string, number> =
                      lastRebalanceData?.pricesAtRebalance || sinceCreationMeta.initialPrices || {};
                    
                    // Get risk contributions from last rebalance
                    const lastRebalanceRiskContrib: Record<string, number> = lastRebalanceData?.riskContributions || {};
                    
                    // Calculate current metrics for each holding
                    const holdings = targetAllocations.map((allocation: any) => {
                      const currentPrice = getClosingPrice(allocation.symbol);
                      const rebalancePrice = pricesAtRebalance[allocation.symbol] || currentPrice;
                      
                      // Calculate shares and current value
                      const initialValue = 10000 * (allocation.weight / 100);
                      const shares = rebalancePrice > 0 ? initialValue / rebalancePrice : 0;
                      const currentValue = shares * currentPrice;
                      
                      // Calculate return since last rebalance
                      const returnPercent = rebalancePrice > 0 
                        ? ((currentPrice - rebalancePrice) / rebalancePrice * 100) 
                        : 0;
                      
                      return {
                        symbol: allocation.symbol,
                        targetWeight: allocation.weight,
                        currentValue,
                        rebalancePrice,
                        currentPrice,
                        returnPercent
                      };
                    });
                    
                    const totalValue = holdings.reduce((sum: number, h: any) => sum + h.currentValue, 0);
                    
                    return holdings.map((h: any, i: number) => {
                      const currentWeight = totalValue > 0 ? (h.currentValue / totalValue * 100) : h.targetWeight;
                      const todaysTargetWeight = todaysTargetMap[h.symbol] ?? h.targetWeight ?? 0;
                      const drift = currentWeight - todaysTargetWeight;
                      
                      // UPDATED LOGIC HERE: Use the Drifted Risk Contribution from state if available
                      // If available, this comes from the backend calculation (Euler decomp).
                      // If not (legacy portfolio), fallback to current weight approximation.
                      const riskContribDisplay = currentRiskContributions[h.symbol] !== undefined
                        ? currentRiskContributions[h.symbol].toFixed(2)
                        : currentWeight.toFixed(2);
                      
                      return (
                        <tr key={i} className="border-b border-slate-600/20 hover:bg-slate-700/30 transition">
                          <td className="py-3 pr-4 font-bold text-white">{h.symbol}</td>
                          <td className="py-3 pr-4 text-right text-slate-300">{todaysTargetWeight.toFixed(2)}%</td>
                          <td className="py-3 pr-4 text-right font-semibold text-white">{currentWeight.toFixed(2)}%</td>
                          <td className="py-3 pr-4 text-right">
                            <span className={`font-semibold ${
                              drift > 0.5 ? 'text-emerald-400' : drift < -0.5 ? 'text-red-400' : 'text-slate-300'
                            }`}>
                              {drift > 0 ? '+' : ''}{drift.toFixed(2)}%
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <span className={`font-bold ${
                              h.returnPercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              {h.returnPercent >= 0 ? '+' : ''}{h.returnPercent.toFixed(2)}%
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-right text-slate-300">
                            {riskContribDisplay}%
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
            <div className="mt-4 p-3 rounded-lg border border-purple-500/30 bg-purple-500/10">
              <p className="text-xs text-purple-200">
                <strong>Risk Contribution:</strong> This value calculates the percentage of total portfolio risk contributed by each asset. 
                It uses the current (drifted) weights and the rolling {p.proposalSummary?.lookbackPeriod || '5y'} covariance matrix. 
                When RC equals Target Weight, the portfolio is perfectly balanced (ERC). Deviations indicate the need to rebalance.
              </p>
            </div>
          </div>

            {/* Correlation Matrix */}
            {p.proposalSummary && (
              <div className="mt-8 mb-6 rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl">
                <h2 className="text-2xl font-bold text-white mb-4">Asset Correlation Matrix</h2>
                <p className="text-sm text-slate-300 mb-4">
                  Shows how assets move together. Lower correlations = better diversification.
                </p>
                <div className="mb-4 rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
                  <p className="text-xs text-purple-200">
                    <strong>Note:</strong> Correlations calculated using price returns only (excluding dividends). 
                    This provides a more accurate measure of how assets move together, as dividends are predictable 
                    scheduled payments, not market volatility.
                  </p>
                </div>
                
                {loadingSinceCreation ? (
                  <div className="text-center py-8">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-400 border-t-purple-500"></div>
                    <p className="text-sm text-slate-300 mt-2">Loading correlation data...</p>
                  </div>
                ) : (() => {
                  const hasRebalanceData = sinceCreationRebalancingData.length > 0;
                  const lastRebalance = hasRebalanceData ? sinceCreationRebalancingData[sinceCreationRebalancingData.length - 1] : null;
                  const hasRebalanceCorr = lastRebalance?.correlationMatrix;
                  const hasSummaryCorr = p.proposalSummary?.correlationMatrix;
                  
                  console.log('Correlation Debug:', {
                    hasRebalanceData,
                    lastRebalance,
                    hasRebalanceCorr,
                    hasSummaryCorr,
                    proposalSummary: p.proposalSummary
                  });
                  
                  if (hasRebalanceCorr) {
                    return (
                      <>
                        <p className="text-sm text-slate-300 mb-4">
                          Updated at last rebalance: {new Date(lastRebalance.date).toLocaleDateString()}
                        </p>
                        <CorrelationMatrixDisplay 
                          holdings={p.proposalHoldings} 
                          correlationMatrix={lastRebalance.correlationMatrix}
                          avgCorrelation={lastRebalance.avgCorrelation}
                        />
                      </>
                    );
                  } else if (hasSummaryCorr) {
                    return (
                      <>
                        <p className="text-sm text-slate-300 mb-4">
                          Initial correlation matrix from portfolio creation ({p.proposalSummary.lookbackPeriod || '5y'} lookback)
                        </p>
                        <CorrelationMatrixDisplay 
                          holdings={p.proposalHoldings} 
                          correlationMatrix={p.proposalSummary.correlationMatrix}
                          avgCorrelation={p.proposalSummary.avgCorrelation || "N/A"}
                        />
                      </>
                    );
                  } else {
                    return (
                      <div className="text-center py-8 text-slate-400">
                        <p>Correlation data will be available after the first rebalancing period</p>
                        <p className="text-xs mt-2">Debug: No correlation matrix found in rebalance or summary data</p>
                      </div>
                    );
                  }
                })()}
              </div>
            )}
          </>
        )}

        {!p.proposalHoldings || p.proposalHoldings.length === 0 && (
          <div className="rounded-2xl border border-slate-600/50 bg-slate-800/60 p-12 backdrop-blur-xl shadow-2xl text-center">
            <h2 className="text-2xl font-bold text-white mb-3">
              No Analysis Yet
            </h2>
            <p className="text-slate-200 mb-6">
              This portfolio hasn't been analyzed yet
            </p>
            <Link
              href={`/portfolio/setup?pid=${p.id}`}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-6 py-3 font-semibold shadow-lg hover:from-emerald-600 hover:to-emerald-700 transition-all"
            >
              Start Analysis
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function CorrelationMatrixDisplay({ holdings, correlationMatrix, avgCorrelation }: { holdings: any[], correlationMatrix: number[][], avgCorrelation: string }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left text-slate-200">Asset</th>
              {holdings.map((h) => (
                <th key={h.symbol} className="p-2 text-center text-slate-200 font-medium">
                  {h.symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {correlationMatrix.map((row: number[], i: number) => (
              <tr key={i} className="border-t border-slate-600/30">
                <td className="p-2 font-medium text-white">
                  {holdings[i].symbol}
                </td>
                {row.map((corr: number, j: number) => (
                  <td
                    key={j}
                    className="p-2 text-center font-semibold"
                    style={{
                      backgroundColor: corr > 0 
                        ? `rgba(239, 68, 68, ${0.3 + Math.abs(corr) * 0.7})` // Red for positive
                        : `rgba(34, 197, 94, ${0.3 + Math.abs(corr) * 0.7})`, // Green for negative
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
      
      <div className="mt-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-3 rounded" style={{background: 'rgba(34, 197, 94, 1)'}}></div>
            <span className="text-slate-300">Negative (diversifies)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-3 rounded" style={{background: 'rgba(239, 68, 68, 1)'}}></div>
            <span className="text-slate-300">Positive (moves together)</span>
          </div>
        </div>
        {avgCorrelation && (
          <span className="text-slate-200 font-semibold">
            Avg Correlation: {avgCorrelation}
          </span>
        )}
      </div>
    </>
  );
}

const CHART_COLORS = [
  '#10b981', // emerald-500
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
];

function AllocationPieChart({ weights }: { weights: any[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = 360; // degrees in circle
  
  let currentAngle = 0;
  const segments = weights.map((w, i) => {
    const percentage = parseFloat(w.weight);
    const angle = (percentage / 100) * total;
    const segment = {
      ...w,
      percentage,
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
      color: CHART_COLORS[i % CHART_COLORS.length],
    };
    currentAngle += angle;
    return segment;
  });

  const radius = 80;
  const centerX = 100;
  const centerY = 100;

  return (
  <div className="flex flex-col items-center">
    {/* WRAP svg + center label together */}
    <div className="relative">
      <svg width="200" height="200" viewBox="0 0 200 200" className="mb-4">
        {segments.map((segment, i) => {
          const startAngle = (segment.startAngle - 90) * (Math.PI / 180);
          const endAngle   = (segment.endAngle   - 90) * (Math.PI / 180);

          const x1 = centerX + radius * Math.cos(startAngle);
          const y1 = centerY + radius * Math.sin(startAngle);
          const x2 = centerX + radius * Math.cos(endAngle);
          const y2 = centerY + radius * Math.sin(endAngle);

          const largeArc = segment.endAngle - segment.startAngle > 180 ? 1 : 0;

          const pathData = [
            `M ${centerX} ${centerY}`,
            `L ${x1} ${y1}`,
            `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
            'Z',
          ].join(' ');

          return (
            <path
              key={i}
              d={pathData}
              fill={segment.color}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={1}
              className="transition-all cursor-pointer"
              style={{
                opacity:
                  hoveredIndex === null || hoveredIndex === i ? 1 : 0.4,
                transform:
                  hoveredIndex === i ? 'scale(1.05)' : 'scale(1)',
                transformOrigin: 'center',   // better for SVG
                transformBox: 'fill-box',    // ensures scaling from the slice
              }}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          );
        })}
      </svg>

      {/* Center label, now correctly positioned over the svg */}
      {hoveredIndex !== null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <div className="text-xs font-semibold text-white">
            {segments[hoveredIndex].ticker}
          </div>
          <div className="text-lg font-bold text-white">
            {segments[hoveredIndex].percentage.toFixed(1)}%
          </div>
        </div>
      )}
    </div>

    {/* Legend / weights list */}
    <div className="w-full space-y-2">
      {weights.map((w, i) => (
        <div
          key={i}
          className="flex items-center justify-between text-sm transition-opacity cursor-pointer"
          style={{
            opacity:
              hoveredIndex === null || hoveredIndex === i ? 1 : 0.5,
          }}
          onMouseEnter={() => setHoveredIndex(i)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{
                backgroundColor:
                  CHART_COLORS[i % CHART_COLORS.length],
              }}
            />
            <span className="font-medium text-white">{w.ticker}</span>
          </div>
          <span className="text-slate-300">
            {typeof w.weight === 'number'
              ? `${w.weight.toFixed?.(1) ?? w.weight}%`
              : w.weight}
          </span>
        </div>
      ))}
    </div>
  </div>
);
}

// Simple metric box used in the summary grid
function MetricBox({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "number"
      ? value.toString()
      : value;

  return (
    <div className="rounded-xl border border-slate-500/30 bg-slate-700/30 p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-lg font-bold text-white">{display}</div>
    </div>
  );
}
