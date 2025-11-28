// filepath: /Users/johnjohn/my-ai-app/src/lib/backtest.ts
import { 
  calculateReturns, 
  calculateCovarianceMatrix, 
  optimizeERC,
  calculateRiskContributions,
} from "@/lib/riskBudgeting";
import { optimizeExpectedShortfall } from "@/lib/optimizerES";

/**
 * Portfolio Backtesting and Advanced Analytics
 * * This module provides functions for:
 * - Historical portfolio simulation
 * - Rebalancing strategies (QARM methodology)
 * - Performance metrics calculation
 * - Stress testing
 */

export interface RebalanceEvent {
  date: string;
  portfolioValue: number;
  volatility?: number;
  sharpe?: number;
  quarterlyReturn?: number;
  changes: {
    ticker: string;
    beforeWeight: number;
    afterWeight: number;
    drift: number;
    tradeAmount?: number; // Dollar amount traded for this asset
  }[];
  totalTradingVolume?: number; // Total $ amount of all trades
  transactionCost?: number; // Total transaction costs paid
  pricesAtRebalance?: Record<string, number>; // Snapshot of prices used to size the trades
  riskContributions?: Record<string, number>; // Risk contribution (≈ weights) at rebalance
}

export interface BacktestResult {
  portfolioValues: number[];
  returns: number[];
  dates: string[];
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPeriod: { start: string; end: string };
  rebalanceCount: number;
  rebalanceDates?: RebalanceEvent[];
  dividendCash?: number;  // Total dividend cash with actual compounding
  dividendCashIfReinvested?: number;  // What dividends WOULD BE if reinvested (when OFF)
  missedDividendOpportunity?: number;  // Difference between reinvested and non-reinvested
  shadowPortfolioValue?: number;  // Final value if dividends WERE reinvested (when OFF)
  shadowTotalReturn?: number;  // Total return if dividends WERE reinvested (when OFF)
  // NEW: Store Drifted Risk Contributions
  currentRiskContributions?: Record<string, number>;
}

export interface RebalanceConfig {
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  transactionCost: number; // as decimal, e.g., 0.001 = 0.1%
}

/**
 * Run a historical backtest of a portfolio
 */
export function runBacktest(
  pricesMap: Map<string, number[]>, // ticker -> price array
  dividendsMap: Map<string, number[]>, // ticker -> dividend array
  dates: string[],
  initialWeights: number[], // Initial weights (renamed for clarity)
  tickers: string[],
  rebalanceConfig: RebalanceConfig,
  initialValue: number = 10000,
  reinvestDividends: boolean = true,  // control whether to reinvest or just track
  targetBudgets?: number[],  // custom risk budgets for rebalancing (optional)
  lookbackPeriodYears?: number,  // User's selected lookback period (1, 3, or 5 years)
  maintainFixedWeights: boolean = false,  // NEW: If true, maintain initial weights at rebalance (for equal weight strategy)
  optimizer: "erc" | "es" = "erc", // NEW: choose optimizer
  outputStartIdx: number = 0       // NEW: burn-in length (days to exclude from outputs/metrics)
): BacktestResult {
  const n = dates.length;
  
  // --- SAFETY CHECK FOR NEW PORTFOLIOS (One-liner fix concept) ---
  // If we have 0 or 1 data point, we can't run a simulation. 
  // Return a safe "empty" result to prevent API crashes.
  if (n < 2) {
    const safeWeights: Record<string, number> = {};
    tickers.forEach((t, i) => safeWeights[t] = initialWeights[i] * 100);
    
    return {
      portfolioValues: [initialValue],
      returns: [],
      dates: dates,
      finalValue: initialValue,
      totalReturn: 0,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPeriod: { start: dates[0] || "", end: dates[0] || "" },
      rebalanceCount: 0,
      rebalanceDates: [],
      dividendCash: 0,
      dividendCashIfReinvested: 0,
      missedDividendOpportunity: 0,
      shadowPortfolioValue: initialValue,
      shadowTotalReturn: 0,
      currentRiskContributions: safeWeights, // Fallback to target RC
    };
  }

  const sliceStart = Math.max(0, Math.min(outputStartIdx, n - 1));
  let dividendCashAtSliceStart = 0;
  let dividendCashIfReinvestedAtSliceStart = 0;
  let shadowValueAtSliceStart = 0;
  const portfolioValues: number[] = [initialValue];
  const returns: number[] = [];
  let totalDividendCash = 0;  // Track cumulative dividend cash with current strategy
  let totalDividendCashIfReinvested = 0;  // Track what dividends would be if reinvested (shadow portfolio)
  
  for (const ticker of tickers) {
    const prices = pricesMap.get(ticker);
    if (!prices || prices.length === 0) {
      throw new Error(`No price data available for ${ticker}`);
    }
    if (prices.length !== n) {
      throw new Error(`Price data length mismatch for ${ticker}: expected ${n}, got ${prices.length}`);
    }
  }
  
  // Track current weights (will change at each rebalance)
  let currentWeights = [...initialWeights];
  let previousTargetWeights = [...initialWeights];  // Track previous rebalance targets
  
  // Initialize positions (number of shares for each asset)
  const shares = currentWeights.map((w: number, i: number) => {
    const ticker = tickers[i];
    const prices = pricesMap.get(ticker)!;
    const targetValue = initialValue * w;  // Dollar amount to invest
    // Safety check for price
    return prices[0] > 0 ? targetValue / prices[0] : 0;
  });
  
  // ALWAYS track shadow portfolio for comparison (regardless of reinvestDividends setting)
  const shadowShares = [...shares];
  
  let rebalanceCount = 0;
  let lastRebalanceDate = dates[0];
  const rebalanceEvents: RebalanceEvent[] = [];
  
  // Simulate each day
  for (let t = 1; t < n; t++) {
    let cashFromDividends = 0; // Track uninvested cash
    
    // STEP 1: Process dividends (before price movement)
    tickers.forEach((ticker, i) => {
      const dividends = dividendsMap.get(ticker)!;
      const dividendPerShare = dividends[t];
      
      if (dividendPerShare > 0) {
        const dividendCash = shares[i] * dividendPerShare;
        totalDividendCash += dividendCash;
        
        if (reinvestDividends) {
          // USER CHOICE: DRIP - Buy shares at yesterday's closing price
          const prices = pricesMap.get(ticker)!;
          const buyPrice = prices[t - 1];
          if (buyPrice > 0) {
            const additionalShares = dividendCash / buyPrice;
            shares[i] += additionalShares;
          }
        } else {
          // USER CHOICE: Cash - Accrue cash without reinvesting
          cashFromDividends += dividendCash;
        }
        
        // ALWAYS track shadow portfolio (opposite of user's choice)
        const shadowDividendCash = shadowShares[i] * dividendPerShare;
        const prices = pricesMap.get(ticker)!;
        const buyPrice = prices[t - 1];
        
        if (reinvestDividends) {
          // User chose reinvest → shadow shows cash accumulation
          totalDividendCashIfReinvested += shadowDividendCash;
        } else {
          // User chose cash → shadow shows reinvestment
          totalDividendCashIfReinvested += shadowDividendCash;
          if (buyPrice > 0) {
             const shadowAdditionalShares = shadowDividendCash / buyPrice;
             shadowShares[i] += shadowAdditionalShares;
          }
        }
      }
    });
    
    // STEP 2: Calculate portfolio value at today's prices
    // Value = shares × prices + any uninvested cash
    let portfolioValue = cashFromDividends;
    tickers.forEach((ticker, i) => {
      const prices = pricesMap.get(ticker)!;
      portfolioValue += shares[i] * prices[t];
    });
    
    // STEP 3: Calculate return (price-driven only, dividends already handled)
    const previousValue = portfolioValues[portfolioValues.length - 1];
    const dailyReturn = previousValue > 0 ? (portfolioValue - previousValue) / previousValue : 0;
    returns.push(dailyReturn);
    portfolioValues.push(portfolioValue);

    // Snapshot burn-in totals at the start of the displayed window
    if (t === sliceStart) {
      dividendCashAtSliceStart = totalDividendCash;
      dividendCashIfReinvestedAtSliceStart = totalDividendCashIfReinvested;
      shadowValueAtSliceStart = tickers.reduce((sum, ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        return sum + shadowShares[i] * prices[t];
      }, 0);
    }
    
    // STEP 4: Check for rebalancing
    const lookbackDays = lookbackPeriodYears ? lookbackPeriodYears * 252 : 252;

    if (shouldRebalance(dates[t], lastRebalanceDate, rebalanceConfig.frequency)) {
      const lookbackWindow = Math.min(lookbackDays, t);
      const startIdx = Math.max(0, t - lookbackWindow);

      let newTargetWeights: number[] = [];

      if (maintainFixedWeights) {
        newTargetWeights = [...initialWeights];
        console.log(`  Equal weight rebalancing: maintaining ${(initialWeights[0] * 100).toFixed(1)}% per asset`);
      } else {
        // Safe calculation block
        try {
          // Extract recent daily price returns
          const recentReturnsData: number[][] = [];
          for (const ticker of tickers) {
            const prices = pricesMap.get(ticker)!;
            const recentPrices = prices.slice(startIdx, t + 1);
            if (recentPrices.length < 2) throw new Error("Insufficient data");
            const recentReturns = calculateReturns(recentPrices);
            recentReturnsData.push(recentReturns);
          }

          // Build annualized covariance
          const recentCovMatrix = calculateCovarianceMatrix(recentReturnsData);

          if (optimizer === "es") {
            // Annualized means from recent daily returns
            const muAnnual = recentReturnsData.map(arr => {
              const m = arr.reduce((s, v) => s + v, 0) / Math.max(arr.length, 1);
              return m * 252;
            });
            const esOpt = optimizeExpectedShortfall({
              mu: muAnnual,
              sigma: recentCovMatrix,
              alpha: 0.975,
              budgets: targetBudgets,
              budgetStrength: 400,
            });
            newTargetWeights = esOpt.weights;
          } else {
            const ercOpt = optimizeERC(recentCovMatrix, 1000, 1e-6, targetBudgets);
            newTargetWeights = ercOpt.weights;
          }
        } catch (e) {
          // If optimizer fails (e.g. not enough data), keep current weights
          newTargetWeights = [...currentWeights]; 
        }
      }

      // Update current weights to the newly calculated weights
      currentWeights = newTargetWeights;
      
      // Calculate current weights before rebalancing (for tracking drift)
      const currentWeightsBeforeRebalance = tickers.map((ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        const assetValue = shares[i] * prices[t];
        return (assetValue / portfolioValue) * 100;
      });
      
      // Calculate rolling volatility and Sharpe at this point
      const rollingWindow = Math.min(252, returns.length);
      const recentReturns = returns.slice(-rollingWindow);
      const meanReturn = recentReturns.length > 0 ? recentReturns.reduce((sum, r) => sum + r, 0) / recentReturns.length : 0;
      const variance = recentReturns.length > 0 ? recentReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / recentReturns.length : 0;
      const rollingVol = Math.sqrt(variance * 252) * 100; // Annualized
      const annualizedMeanReturn = meanReturn * 252 * 100;
      const rollingSharpe = rollingVol > 0 ? annualizedMeanReturn / rollingVol : 0;
      
      // Calculate quarterly return (last ~60 trading days)
      const quarterWindow = Math.min(60, portfolioValues.length);
      const quarterStartValue = portfolioValues[portfolioValues.length - quarterWindow];
      const quarterEndValue = portfolioValue;
      const quarterlyReturn = quarterStartValue > 0 ? ((quarterEndValue - quarterStartValue) / quarterStartValue) * 100 : 0;
      
      // SMART TRANSACTION COST CALCULATION:
      let totalTradingVolume = 0;
      tickers.forEach((ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        const currentValue = shares[i] * prices[t];  // Current position value
        const targetValue = portfolioValue * currentWeights[i];  // Target position value
        const tradeAmount = Math.abs(targetValue - currentValue);  // How much to buy/sell
        totalTradingVolume += tradeAmount;
      });
      
      // Apply transaction cost ONLY to the traded amount
      const totalTransactionCost = totalTradingVolume * rebalanceConfig.transactionCost;
      const portfolioAfterCosts = portfolioValue - totalTransactionCost;
      
      // Rebalance ACTUAL portfolio: buy new shares at NEW OPTIMIZED weights
      tickers.forEach((ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        const targetValue = portfolioAfterCosts * currentWeights[i];  // Use NEW weights!
        shares[i] = prices[t] > 0 ? targetValue / prices[t] : 0;  // New share count
      });
      
      // Important: Update the portfolio value for THIS day to reflect transaction costs
      portfolioValue = portfolioAfterCosts;
      portfolioValues[portfolioValues.length - 1] = portfolioValue;  // Update the most recently added value
      
      // ALWAYS rebalance shadow portfolio at same times (with same costs)
      let shadowPortfolioValueAtRebalance = 0;
      tickers.forEach((ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        shadowPortfolioValueAtRebalance += shadowShares[i] * prices[t];
      });
      
      // Apply same transaction cost percentage
      const shadowTotalTradingVolume = tickers.reduce((sum, ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        const currentValue = shadowShares[i] * prices[t];
        const targetValue = shadowPortfolioValueAtRebalance * currentWeights[i];
        return sum + Math.abs(targetValue - currentValue);
      }, 0);
      
      const shadowTransactionCost = shadowTotalTradingVolume * rebalanceConfig.transactionCost;
      const shadowPortfolioAfterCosts = shadowPortfolioValueAtRebalance - shadowTransactionCost;
      
      // Rebalance shadow to same NEW optimized weights
      tickers.forEach((ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        const targetValue = shadowPortfolioAfterCosts * currentWeights[i];
        shadowShares[i] = prices[t] > 0 ? targetValue / prices[t] : 0;
      });
      
      // Capture price snapshot for drift calculations
      const pricesAtRebalance: Record<string, number> = {};
      tickers.forEach((ticker, i) => {
        const prices = pricesMap.get(ticker)!;
        pricesAtRebalance[ticker] = parseFloat(prices[t].toFixed(4));
      });

      const riskContributionSnapshot: Record<string, number> = {};
      tickers.forEach((ticker, i) => {
        riskContributionSnapshot[ticker] = parseFloat((currentWeights[i] * 100).toFixed(2));
      });

      // Record rebalance event
      rebalanceEvents.push({
        date: dates[t],
        portfolioValue: parseFloat(portfolioValue.toFixed(2)),
        volatility: parseFloat(rollingVol.toFixed(2)),
        sharpe: parseFloat(rollingSharpe.toFixed(2)),
        quarterlyReturn: parseFloat(quarterlyReturn.toFixed(2)),
        totalTradingVolume: parseFloat(totalTradingVolume.toFixed(2)),
        transactionCost: parseFloat(totalTransactionCost.toFixed(2)),
        changes: tickers.map((ticker, i) => {
          const prices = pricesMap.get(ticker)!;
          const currentValue = shares[i] * prices[t];
          const targetValue = portfolioValue * currentWeights[i];
          const tradeAmount = Math.abs(targetValue - currentValue);
          
          return {
            ticker,
            beforeWeight: parseFloat(currentWeightsBeforeRebalance[i].toFixed(2)),  // Actual drifted weight
            afterWeight: parseFloat((currentWeights[i] * 100).toFixed(2)),  // NEW optimized target
            drift: parseFloat((currentWeightsBeforeRebalance[i] - previousTargetWeights[i] * 100).toFixed(2)),  // How far it drifted from last target
            tradeAmount: parseFloat(tradeAmount.toFixed(2)),
          };
        }),
        pricesAtRebalance,
        riskContributions: riskContributionSnapshot,
      });
      
      // Update previous target weights for next rebalance
      previousTargetWeights = [...currentWeights];
      
      rebalanceCount++;
      lastRebalanceDate = dates[t];
    }
  }

  // ============================================================
  // DRIFTED RISK CONTRIBUTION CALCULATION (With Safety Checks)
  // ============================================================
  
  let currentRiskContributions: Record<string, number> = {};
  let finalDriftedWeights: number[] = [];
  
  try {
    const finalIndex = dates.length - 1;
    
    // 1. Calculate final drifted weights based on shares held at end of simulation
    // Using shares array which is maintained through the loop
    const finalPrices = tickers.map(t => {
      const prices = pricesMap.get(t)!;
      return prices[finalIndex];
    });
    
    const finalAssetValues = shares.map((s, i) => s * finalPrices[i]);
    const totalFinalValue = finalAssetValues.reduce((a, b) => a + b, 0);
    
    // Safety check: ensure we don't divide by zero
    const safeTotalValue = totalFinalValue === 0 ? 1 : totalFinalValue;
    finalDriftedWeights = finalAssetValues.map(v => v / safeTotalValue);

    // 2. Calculate Covariance Matrix for the recent period
    const finalLookbackDays = lookbackPeriodYears ? lookbackPeriodYears * 252 : 252;
    // Safety check: Don't start before index 0
    const startCovIdx = Math.max(0, dates.length - finalLookbackDays);
    
    const finalReturnsData: number[][] = [];
    let hasValidData = true;
    
    for (const ticker of tickers) {
      const prices = pricesMap.get(ticker)!;
      // Safety check: ensure we have enough prices
      if (prices.length < 2) {
        hasValidData = false;
        break;
      }
      
      const recentPrices = prices.slice(startCovIdx, prices.length);
      
      if (recentPrices.length < 2) {
        hasValidData = false;
        break;
      }
      
      const recentReturns = calculateReturns(recentPrices);
      finalReturnsData.push(recentReturns);
    }
    
    if (hasValidData) {
      const finalCovMatrix = calculateCovarianceMatrix(finalReturnsData);
      const { contributions } = calculateRiskContributions(
        finalDriftedWeights,
        finalCovMatrix
      );

      const absContributionSum = contributions.reduce(
        (sum, rc) => sum + Math.abs(rc),
        0
      );

      tickers.forEach((ticker, i) => {
        const rcPct =
          absContributionSum > 0 && Number.isFinite(contributions[i])
            ? (Math.abs(contributions[i]) / absContributionSum) * 100
            : finalDriftedWeights[i] * 100;
        currentRiskContributions[ticker] = parseFloat(rcPct.toFixed(2));
      });
    } else {
      console.warn("Insufficient data for final risk calculation, using weights as fallback");
      // Fallback: RC = Weight if covariance calculation fails
      tickers.forEach((ticker, i) => {
        currentRiskContributions[ticker] = parseFloat((((finalDriftedWeights[i] ?? initialWeights[i] ?? 0)) * 100).toFixed(2));
      });
    }
  } catch (error) {
    console.error("Error calculating drifted risk contributions:", error);
    // Graceful fallback so the whole API doesn't crash
    tickers.forEach((ticker, i) => {
      // Just use the final weight as a fallback
      const fallbackWeight = finalDriftedWeights[i] ?? initialWeights[i] ?? 0;
      currentRiskContributions[ticker] = parseFloat((fallbackWeight * 100).toFixed(2));
    });
  }

  // ============================================================
  // STRICT BURN-IN OUTPUT SLICING
  // ============================================================

  let outDates = dates;
  let outValues = portfolioValues;
  let scale = 1;

  if (sliceStart > 0 && sliceStart < portfolioValues.length) {
    outDates = dates.slice(sliceStart);

    // Rebase so the displayed window starts at initialValue
    const baseVal = portfolioValues[sliceStart];
    scale = baseVal > 0 ? initialValue / baseVal : 1;
    outValues = portfolioValues.slice(sliceStart).map(v => v * scale);
  }

  // Recompute displayed returns from rebased values
  const outReturns: number[] = [];
  for (let i = 1; i < outValues.length; i++) {
    outReturns.push(outValues[i - 1] > 0 ? outValues[i] / outValues[i - 1] - 1 : 0);
  }

  // Filter rebalance events to displayed window
  const outDateSet = new Set(outDates);
  const outRebalanceEventsRaw =
    sliceStart > 0
      ? rebalanceEvents.filter(ev => outDateSet.has(ev.date))
      : rebalanceEvents;


  // If we rebased the displayed window, rescale monetary fields in rebalance events
  const outRebalanceEvents =
    sliceStart > 0
      ? outRebalanceEventsRaw.map(ev => ({
          ...ev,
          portfolioValue: parseFloat((ev.portfolioValue * scale).toFixed(2)),
          totalTradingVolume:
            ev.totalTradingVolume !== undefined
              ? parseFloat((ev.totalTradingVolume * scale).toFixed(2))
              : ev.totalTradingVolume,
          transactionCost:
            ev.transactionCost !== undefined
              ? parseFloat((ev.transactionCost * scale).toFixed(2))
              : ev.transactionCost,
          changes: ev.changes.map(ch => ({
            ...ch,
            tradeAmount:
              ch.tradeAmount !== undefined
                ? parseFloat((ch.tradeAmount * scale).toFixed(2))
                : ch.tradeAmount,
          })),
        }))
      : outRebalanceEventsRaw;



  const outRebalanceCount = outRebalanceEvents.length;

  // Window-only dividend totals (exclude burn-in segment)
  const windowDividendCash = totalDividendCash - dividendCashAtSliceStart;
  const windowDividendCashIfReinvested = totalDividendCashIfReinvested - dividendCashIfReinvestedAtSliceStart;

  // Calculate metrics
  const finalValue = outValues.length > 0 ? outValues[outValues.length - 1] : initialValue;
  const totalReturn = (finalValue - initialValue) / initialValue;

  const displayedYears = (outValues.length - 1) / 252;
  const annualizedReturn =
    displayedYears > 0 ? Math.pow(1 + totalReturn, 1 / displayedYears) - 1 : 0;
  
  const meanReturn =
    outReturns.length > 0
      ? outReturns.reduce((sum, r) => sum + r, 0) / outReturns.length
      : 0;
  const variance =
    outReturns.length > 0
      ? outReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / outReturns.length
      : 0;
  const annualizedVolatility = Math.sqrt(variance * 252);
  
  const sharpeRatio = annualizedVolatility > 0 ? annualizedReturn / annualizedVolatility : 0;
  
  const { maxDD, peakIndex, troughIndex } = calculateDrawdownFromValues(outValues);
  
  // ALWAYS calculate shadow portfolio final value for comparison
  let shadowPortfolioValue = 0;
  tickers.forEach((ticker, i) => {
    const prices = pricesMap.get(ticker);
    const finalPrice = prices && prices.length > 0 ? prices[prices.length - 1] : 0;
    shadowPortfolioValue += shadowShares[i] * finalPrice;
  });

  // Convert shadow portfolio to displayed-window baseline
  let windowShadowPortfolioValue = shadowPortfolioValue;
  if (sliceStart > 0 && shadowValueAtSliceStart > 0) {
    windowShadowPortfolioValue = (shadowPortfolioValue / shadowValueAtSliceStart) * initialValue;
  }
  const windowShadowTotalReturn = ((windowShadowPortfolioValue - initialValue) / initialValue) * 100;

  // Calculate opportunity cost over displayed window
  const missedOpportunity = reinvestDividends
    ? (finalValue - windowShadowPortfolioValue)  // How much better reinvesting was
    : (windowShadowPortfolioValue - finalValue); // How much better reinvesting would have been
  
  return {
    portfolioValues: outValues,
    returns: outReturns,
    dates: outDates,
    finalValue,
    totalReturn: totalReturn * 100,
    annualizedReturn: annualizedReturn * 100,
    annualizedVolatility: annualizedVolatility * 100,
    sharpeRatio,
    maxDrawdown: -Math.abs(maxDD),
    maxDrawdownPeriod: {
      start: outDates[peakIndex] || "",
      end: outDates[troughIndex] || "",
    },
    rebalanceCount: outRebalanceCount,
    rebalanceDates: outRebalanceEvents,
    dividendCash: windowDividendCash,
    dividendCashIfReinvested: windowDividendCashIfReinvested,
    missedDividendOpportunity: missedOpportunity,
    shadowPortfolioValue: windowShadowPortfolioValue,
    shadowTotalReturn: windowShadowTotalReturn,
    currentRiskContributions, // Pass the calculated values back
  };
}

/**
 * Check if rebalancing should occur
 */
function shouldRebalance(
  currentDate: string,
  lastRebalanceDate: string,
  frequency: RebalanceConfig["frequency"]
): boolean {
  const current = new Date(currentDate);
  const last = new Date(lastRebalanceDate);

  switch (frequency) {
    case "daily":
      return true;

    case "weekly":
      return current.getTime() - last.getTime() >= 7 * 24 * 60 * 60 * 1000;

    case "monthly":
      return (
        current.getMonth() !== last.getMonth() ||
        current.getFullYear() !== last.getFullYear()
      );

    case "quarterly": {
      const currentQuarter = Math.floor(current.getMonth() / 3);
      const lastQuarter = Math.floor(last.getMonth() / 3);
      return (
        currentQuarter !== lastQuarter ||
        current.getFullYear() !== last.getFullYear()
      );
    }

    case "annually":
      return current.getFullYear() !== last.getFullYear();

    default:
      return false;
  }
}


/**
 * Calculate max drawdown from portfolio value series
 */
function calculateDrawdownFromValues(values: number[]): {
  maxDD: number;
  peakIndex: number;
  troughIndex: number;
} {
  let maxDD = 0;
  let peak = values[0];
  let peakIndex = 0;
  let maxDDPeakIndex = 0;
  let maxDDTroughIndex = 0;
  
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakIndex = i;
    }
    
    const drawdown = (peak - values[i]) / peak;
    
    if (drawdown > maxDD) {
      maxDD = drawdown;
      maxDDPeakIndex = peakIndex;
      maxDDTroughIndex = i;
    }
  }
  
  return {
    maxDD: maxDD * 100,
    peakIndex: maxDDPeakIndex,
    troughIndex: maxDDTroughIndex,
  };
}

export function stressTestVolatility(
  covMatrix: number[][],
  scaleFactor: number
): number[][] {
  return covMatrix.map(row => row.map(val => val * scaleFactor));
}

export function findWorstPeriod(
  portfolioValues: number[],
  dates: string[],
  windowDays: number = 30
): {
  startIndex: number;
  endIndex: number;
  loss: number;
  startDate: string;
  endDate: string;
} {
  let worstLoss = 0;
  let worstStart = 0;
  let worstEnd = 0;
  
  for (let i = 0; i < portfolioValues.length - windowDays; i++) {
    const startValue = portfolioValues[i];
    const endValue = portfolioValues[i + windowDays];
    const loss = startValue > 0 ? (endValue - startValue) / startValue : 0;
    
    if (loss < worstLoss) {
      worstLoss = loss;
      worstStart = i;
      worstEnd = i + windowDays;
    }
  }
  
  return {
    startIndex: worstStart,
    endIndex: worstEnd,
    loss: worstLoss * 100,
    startDate: dates[worstStart] || "",
    endDate: dates[worstEnd] || "",
  };
}

export function compareStrategies(
  pricesMap: Map<string, number[]>,
  dividendsMap: Map<string, number[]>,
  dates: string[],
  tickers: string[],
  riskBudgetWeights: number[],
  rebalanceConfig: RebalanceConfig,
  reinvestDividends: boolean = true,
  targetBudgets?: number[],
  lookbackPeriodYears?: number,
  optimizer: "erc" | "es" = "erc", // NEW: propagate optimizer
  outputStartIdx: number = 0
): {
  riskBudgeting: BacktestResult;
  equalWeight: BacktestResult;
  marketCap?: BacktestResult;
} {
  const riskBudgeting = runBacktest(
    pricesMap,
    dividendsMap,
    dates,
    riskBudgetWeights,
    tickers,
    rebalanceConfig,
    10000,
    reinvestDividends,
    targetBudgets,
    lookbackPeriodYears,
    false,
    optimizer, // NEW
    outputStartIdx
  );

  const equalWeights = Array(tickers.length).fill(1 / tickers.length);
  const equalWeight = runBacktest(
    pricesMap,
    dividendsMap,
    dates,
    equalWeights,
    tickers,
    rebalanceConfig,
    10000,
    reinvestDividends,
    undefined,
    lookbackPeriodYears,
    true,
    optimizer, // harmless here (fixed weights)
    outputStartIdx
  );

  return { riskBudgeting, equalWeight };
}
