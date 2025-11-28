// filepath: /Users/johnjohn/my-ai-app/src/app/api/risk-budgeting/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  calculateReturns,
  calculateCovarianceMatrix,
  optimizeERC,
  calculateExpectedReturn,
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateCorrelationMatrix,
  calculateAverageCorrelation,
} from "@/lib/riskBudgeting";
import {
  runBacktest,
  compareStrategies,
  findWorstPeriod,
  stressTestVolatility,
} from "@/lib/backtest";
import { optimizeExpectedShortfall } from "@/lib/optimizerES";

interface AssetClass {
  ticker: string;
  name: string;
}

/**
 * Fetch historical data from Yahoo Finance API
 */
async function fetchHistoricalData(ticker: string, lookbackDays: number = 365 * 5): Promise<{ prices: number[]; dates: string[]; dividends: number[] }> {
  try {
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - (lookbackDays * 24 * 60 * 60);
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${startDate}&period2=${endDate}&interval=1d&events=div`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch data for ${ticker}: ${response.status}`);
    }
    
    const data = await response.json();
    
    const result = data?.chart?.result?.[0];
    if (!result) {
      throw new Error(`No data returned for ${ticker}`);
    }
    
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const dividendEvents = result.events?.dividends || {};
    
    const dividendMap = new Map<string, number>();
    for (const [timestamp, divData] of Object.entries(dividendEvents)) {
      const date = new Date(parseInt(timestamp) * 1000).toISOString().split('T')[0];
      dividendMap.set(date, (divData as any).amount || 0);
    }
    
    const prices: number[] = [];
    const dates: string[] = [];
    const dividends: number[] = [];
    
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] !== null && closes[i] !== undefined) {
        const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
        prices.push(closes[i]);
        dates.push(date);
        dividends.push(dividendMap.get(date) || 0);
      }
    }
    
    if (prices.length < 100) {
      throw new Error(`Insufficient data for ${ticker}: only ${prices.length} points`);
    }
    
    return { prices, dates, dividends };
  } catch (error: any) {
    console.error(`Error fetching data for ${ticker}:`, error.message);
    throw error;
  }
}

/**
 * Align price series to common dates
 */
function alignPriceSeries(
  dataMap: Map<string, { prices: number[]; dates: string[]; dividends: number[] }>
): { prices: Map<string, number[]>, dividends: Map<string, number[]> } {
  const tickers = Array.from(dataMap.keys());
  const dateSets = tickers.map(t => new Set(dataMap.get(t)!.dates));
  const commonDates = Array.from(dateSets[0]).filter(date =>
    dateSets.every(set => set.has(date))
  ).sort();
  
  const alignedPrices = new Map<string, number[]>();
  const alignedDividends = new Map<string, number[]>();
  
  for (const ticker of tickers) {
    const data = dataMap.get(ticker)!;
    const dateToPrice = new Map(data.dates.map((d, i) => [d, data.prices[i]]));
    const dateToDividend = new Map(data.dates.map((d, i) => [d, data.dividends[i]]));
    
    const pricesArray = commonDates.map(date => dateToPrice.get(date)!);
    const dividendsArray = commonDates.map(date => dateToDividend.get(date) || 0);
    
    alignedPrices.set(ticker, pricesArray);
    alignedDividends.set(ticker, dividendsArray);
  }
  
  return { prices: alignedPrices, dividends: alignedDividends };
}

export async function POST(req: NextRequest) {
  console.log("=== RISK BUDGETING API CALLED ===");
  
  try {
    const { assetClasses, customBudgets, targetVolatility, lookbackPeriod = '5y', includeDividends = true } = await req.json();
    const optimizer = (req.nextUrl.searchParams.get("optimizer") || "erc").toLowerCase();
    
    if (!Array.isArray(assetClasses) || assetClasses.length < 2) {
      return NextResponse.json(
        { error: "Please provide at least 2 asset classes" },
        { status: 400 }
      );
    }

    if (customBudgets && Array.isArray(customBudgets)) {
      if (customBudgets.length !== assetClasses.length) {
        return NextResponse.json(
          { error: "Custom budgets length must match asset classes" },
          { status: 400 }
        );
      }
      const sum = customBudgets.reduce((s: number, v: number) => s + v, 0);
      if (Math.abs(sum - 100) > 0.01) {
        return NextResponse.json(
          { error: `Custom budgets must sum to 100%. Current sum: ${sum.toFixed(2)}%` },
          { status: 400 }
        );
      }
    }
    
    const periodToYears: Record<string, number> = { '1y': 1, '3y': 3, '5y': 5 };
    const sanitizedLookback = (lookbackPeriod === '1y' || lookbackPeriod === '3y' || lookbackPeriod === '5y')
      ? lookbackPeriod
      : '5y';
    const lookbackYears = periodToYears[sanitizedLookback];
    const lookbackDays = lookbackYears * 365;
    const daysToFetch = lookbackDays * 2;

    const dataPromises = assetClasses.map((asset: AssetClass) =>
      fetchHistoricalData(asset.ticker, daysToFetch).then(data => ({ ticker: asset.ticker, ...data }))
    );

    const historicalData = await Promise.all(dataPromises);
    const dataMap = new Map(
      historicalData.map(d => [d.ticker, { prices: d.prices, dates: d.dates, dividends: d.dividends }])
    );

    const { prices: alignedPrices, dividends: alignedDividends } = alignPriceSeries(dataMap);
    const totalPoints = Array.from(alignedPrices.values())[0].length;
    const splitPoint = Math.floor(totalPoints / 2);
    
    const backtestWeightsPrices = new Map<string, number[]>();
    for (const [ticker, prices] of alignedPrices.entries()) {
      backtestWeightsPrices.set(ticker, prices.slice(0, splitPoint));
    }
    
    const todaysPrices = new Map<string, number[]>();
    const todaysDividends = new Map<string, number[]>();
    for (const [ticker, prices] of alignedPrices.entries()) {
      todaysPrices.set(ticker, prices.slice(splitPoint));
      todaysDividends.set(ticker, alignedDividends.get(ticker)!.slice(splitPoint));
    }
    
    const backtestPrices = new Map<string, number[]>();
    const backtestDividends = new Map<string, number[]>();
    for (const [ticker, prices] of alignedPrices.entries()) {
      backtestPrices.set(ticker, prices.slice(splitPoint));
      backtestDividends.set(ticker, alignedDividends.get(ticker)!.slice(splitPoint));
    }
    
    const backtestWeightsReturns: number[][] = [];
    const backtestTickers: string[] = [];
    for (const asset of assetClasses) {
      const prices = backtestWeightsPrices.get(asset.ticker)!;
      const priceReturns = calculateReturns(prices);
      backtestWeightsReturns.push(priceReturns);
      backtestTickers.push(asset.ticker);
    }
    const backtestCovMatrix = calculateCovarianceMatrix(backtestWeightsReturns);
    const nBacktest = backtestTickers.length;
    const equalBacktestBudgets = Array(nBacktest).fill(1 / nBacktest);
    const backtestTargetBudgets = customBudgets ? customBudgets.map((b: number) => b / 100) : equalBacktestBudgets;

    let backtestInitialWeights: number[];
    if (optimizer === "es") {
      const muAnnualOlder = backtestWeightsReturns.map(arr => {
        const m = arr.reduce((s, v) => s + v, 0) / Math.max(arr.length, 1);
        return m * 252;
      });
      const esOptOlder = optimizeExpectedShortfall({
        mu: muAnnualOlder,
        sigma: backtestCovMatrix,
        alpha: 0.975,
        budgets: backtestTargetBudgets,
        budgetStrength: 400,
      });
      backtestInitialWeights = esOptOlder.weights;
    } else {
      const ercOptOlder = optimizeERC(backtestCovMatrix, 1000, 1e-6, backtestTargetBudgets);
      backtestInitialWeights = ercOptOlder.weights;
    }

    const priceReturnsData: number[][] = [];
    const totalReturnsData: number[][] = [];
    const meanReturns: number[] = [];
    const tickers: string[] = [];
    
    for (const asset of assetClasses) {
      const prices = todaysPrices.get(asset.ticker)!;
      const dividends = todaysDividends.get(asset.ticker)!;
      
      const priceReturns = calculateReturns(prices);
      priceReturnsData.push(priceReturns);
      
      const totalReturns = includeDividends 
        ? calculateReturns(prices, dividends)
        : priceReturns;
      totalReturnsData.push(totalReturns);
      
      const meanReturn = totalReturns.reduce((sum, r) => sum + r, 0) / totalReturns.length * 252;
      meanReturns.push(meanReturn);
      tickers.push(asset.ticker);
    }
    
    const covMatrix = calculateCovarianceMatrix(priceReturnsData);
    
    const nAssets = tickers.length;
    const equalBudgets = Array(nAssets).fill(1 / nAssets);
    const targetBudgets = customBudgets 
      ? customBudgets.map((b: number) => b / 100)
      : equalBudgets;

    let optimization: any;

    if (optimizer === "es") {
      optimization = optimizeExpectedShortfall({
        mu: meanReturns,
        sigma: covMatrix,
        alpha: 0.975,
        budgets: targetBudgets,
        budgetStrength: 400,
        caps: undefined,
      });
    } else {
      optimization = optimizeERC(covMatrix, 1000, 1e-6, targetBudgets);
    }

    // FIX: Cast to number[] to ensure TypeScript infers type correctly
    const baseWeights = optimization.weights as number[];
    const portfolioVol =
      optimizer === "es"
        ? Math.sqrt(Math.max(0, quadraticFormFromCov(baseWeights, covMatrix)))
        : (optimization as any).portfolioVolatility;

    let finalWeights = [...baseWeights];
    let scalingFactor = 1;
    const naturalVol = portfolioVol;
    
    if (targetVolatility && targetVolatility > 0) {
      scalingFactor = targetVolatility / naturalVol;
      // Now w is correctly identified as a number
      finalWeights = baseWeights.map(w => w * scalingFactor);
    }
    
    const expectedReturn = calculateExpectedReturn(finalWeights, meanReturns);
    const targetedVol = targetVolatility || naturalVol;
    const sharpeRatio = calculateSharpeRatio(expectedReturn, targetedVol);
    
    const maxDrawdowns = assetClasses.map((asset: AssetClass) => {
      const prices = alignedPrices.get(asset.ticker)!;
      return calculateMaxDrawdown(prices);
    });
    const portfolioMaxDD = optimization.weights.reduce(
      (sum: number, w: number, i: number) => sum + w * maxDrawdowns[i],
      0
    ) * scalingFactor;

    // Compute drifted "current" weights and risk contributions as of last close
    let currentWeights: number[] = [];
    let currentRiskContributions: number[] = [];
    let currentRiskContributionShares: number[] = [];

    try {
      const initialCapital = 10000;
      const initialAllocations = finalWeights.map(w => w * initialCapital);

      const firstPrices = assetClasses.map(asset => {
        const series = todaysPrices.get(asset.ticker)!;
        return series[0];
      });
      const lastPrices = assetClasses.map(asset => {
        const series = todaysPrices.get(asset.ticker)!;
        return series[series.length - 1];
      });

      const shares = initialAllocations.map((dollars, i) =>
        firstPrices[i] > 0 ? dollars / firstPrices[i] : 0
      );
      const finalValuesPerAsset = shares.map((sh, i) => sh * lastPrices[i]);
      const finalTotal = finalValuesPerAsset.reduce((a, b) => a + b, 0) || 1;
      currentWeights = finalValuesPerAsset.map(v => v / finalTotal);

      // Risk contributions using the Euler decomposition: RC_i = w_i * (Sigma * w)_i / TotalVariance
      const sigmaW = covMatrix.map(row =>
        row.reduce((sum, value, idx) => sum + value * currentWeights[idx], 0)
      );
      
      const rawRC = currentWeights.map((w, i) => w * sigmaW[i]);
      const totalVariance = rawRC.reduce((a, b) => a + b, 0) || 1;
      
      currentRiskContributionShares = rawRC.map(rc => rc / totalVariance);
      currentRiskContributions = currentRiskContributionShares.map(share => share * 100);

    } catch (err) {
      console.warn("Failed to compute current drifted risk contributions:", err);
      currentWeights = [...finalWeights];
      currentRiskContributions = finalWeights.map(w => w * 100); 
      currentRiskContributionShares = finalWeights;
    }
    
    // Format results
    const weights = assetClasses.map((asset: AssetClass, i: number) => ({
      name: asset.name,
      ticker: asset.ticker,
      weight: (finalWeights[i] * 100).toFixed(2),
      riskContribution: optimizer === "es"
        ? (((optimization as any).riskContributionShares?.[i] ?? 0) * 100).toFixed(2)
        : (optimization as any).riskContributions[i].toFixed(2),
      currentWeight: (currentWeights[i] * 100).toFixed(2),
      // Drifted Current RC
      currentRiskContribution: currentRiskContributions[i].toFixed(2),
    }));
    
    const metrics = {
      portfolioVolatility: (targetedVol * 100).toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2),
      expectedReturn: expectedReturn.toFixed(2),
      maxDrawdown: portfolioMaxDD.toFixed(2),
      ...(optimizer === "es"
        ? {
            ES: (optimization as any).expectedShortfall.toFixed(6),
            H: (optimization as any).entropy.toFixed(6),
            D: (optimization as any).diversification.toFixed(6),
          }
        : {}),
    };
    
    const asOf = new Date().toISOString().split('T')[0];
    
    const correlationMatrix = calculateCorrelationMatrix(covMatrix);
    const avgCorrelation = calculateAverageCorrelation(correlationMatrix);
    
    console.log("Running historical backtest...");
    
    const backtestDateArray = historicalData[0].dates.slice(splitPoint);
    const useStrictBurnIn = optimizer === "es";
    const pricesForBacktest = useStrictBurnIn ? alignedPrices : backtestPrices;
    const dividendsForBacktest = useStrictBurnIn ? alignedDividends : backtestDividends;
    const datesForBacktest = useStrictBurnIn ? historicalData[0].dates : backtestDateArray;
    const outputStartIdx = useStrictBurnIn ? splitPoint : 0;

    const backtest = runBacktest(
      pricesForBacktest,
      dividendsForBacktest,
      datesForBacktest,
      backtestInitialWeights,
      tickers,
      { frequency: 'quarterly', transactionCost: 0.001 },
      10000,
      includeDividends,
      backtestTargetBudgets,
      lookbackYears,
      false,
      optimizer as "erc" | "es",
      outputStartIdx
    );

    const comparison = compareStrategies(
      pricesForBacktest,
      dividendsForBacktest,
      datesForBacktest,
      tickers,
      backtestInitialWeights,
      { frequency: 'quarterly', transactionCost: 0.001 },
      includeDividends,
      backtestTargetBudgets,
      lookbackYears,
      optimizer as "erc" | "es",
      outputStartIdx
    );

    const worstPeriod = findWorstPeriod(backtest.portfolioValues, backtest.dates, 30);
    
    let dividendContribution;
    const avgDividendYields = tickers.map((ticker, i) => {
      const divs = backtestDividends.get(ticker)!;
      const prices = backtestPrices.get(ticker)!;
      let totalYield = 0;
      let divPayments = 0;
      
      for (let idx = 1; idx < divs.length; idx++) {
        if (divs[idx] > 0 && prices[idx - 1] > 0) {
          totalYield += (divs[idx] / prices[idx - 1]);
          divPayments++;
        }
      }
      
      const avgYieldPerPayment = divPayments > 0 ? totalYield / divPayments : 0;
      const paymentsPerYear = divPayments > 0 ? (divPayments / (divs.length / 252)) : 4;
      return avgYieldPerPayment * paymentsPerYear * 100;
    });
    
    const portfolioDivYield = optimization.weights.reduce((sum: number, w: number, i: number) => {
      return sum + w * avgDividendYields[i];
    }, 0);
    
    dividendContribution = {
      portfolioDividendYield: portfolioDivYield.toFixed(2),
      assetYields: tickers.map((ticker, i) => ({
        ticker,
        yield: avgDividendYields[i].toFixed(2)
      })),
      calculatedOver: `${lookbackPeriod} backtest period`
    };
    
    return NextResponse.json({
      weights,
      metrics,
      asOf,
      correlationMatrix,
      avgCorrelation,
      optimization: {
        converged: optimization.converged,
        iterations: optimization.iterations,
      },
      includeDividends,
      dividendContribution,
      volatilityTargeting: targetVolatility ? {
        targetVolatility: (targetVolatility * 100).toFixed(2),
        naturalVolatility: (naturalVol * 100).toFixed(2),
        scalingFactor: scalingFactor.toFixed(3),
        leverage: scalingFactor > 1 ? `${((scalingFactor - 1) * 100).toFixed(1)}% leverage` : `${((1 - scalingFactor) * 100).toFixed(1)}% cash`,
      } : undefined,
      esAnalytics: optimizer === "es"
        ? {
            ES: (optimization as any).expectedShortfall.toFixed(6),
            RC: (optimization as any).riskContributions.map((v: number) => v.toFixed(6)),
            RCshare: (optimization as any).riskContributionShares.map((v: number) => v.toFixed(6)),
            H: (optimization as any).entropy.toFixed(6),
            D: (optimization as any).diversification.toFixed(6),
          }
        : undefined,
      analytics: {
        backtest: {
          finalValue: backtest.finalValue.toFixed(2),
          totalReturn: backtest.totalReturn.toFixed(2),
          annualizedReturn: backtest.annualizedReturn.toFixed(2),
          annualizedVolatility: backtest.annualizedVolatility.toFixed(2),
          sharpeRatio: backtest.sharpeRatio.toFixed(2),
          maxDrawdown: backtest.maxDrawdown.toFixed(2),
          maxDrawdownPeriod: backtest.maxDrawdownPeriod,
          rebalanceCount: backtest.rebalanceCount,
          portfolioValues: backtest.portfolioValues.map(v => parseFloat(v.toFixed(2))),
          dates: backtest.dates,
          rebalanceDates: backtest.rebalanceDates,
          dividendCash: backtest.dividendCash ? parseFloat(backtest.dividendCash.toFixed(2)) : undefined,
          dividendCashIfReinvested: backtest.dividendCashIfReinvested ? parseFloat(backtest.dividendCashIfReinvested.toFixed(2)) : undefined,
          missedDividendOpportunity: backtest.missedDividendOpportunity ? parseFloat(backtest.missedDividendOpportunity.toFixed(2)) : undefined,
          shadowPortfolioValue: backtest.shadowPortfolioValue ? parseFloat(backtest.shadowPortfolioValue.toFixed(2)) : undefined,
          shadowTotalReturn: backtest.shadowTotalReturn ? parseFloat(backtest.shadowTotalReturn.toFixed(2)) : undefined,
          currentRiskContributions: backtest.currentRiskContributions,
        },
        comparison: {
          riskBudgeting: {
            return: comparison.riskBudgeting.annualizedReturn.toFixed(2),
            volatility: comparison.riskBudgeting.annualizedVolatility.toFixed(2),
            sharpe: comparison.riskBudgeting.sharpeRatio.toFixed(2),
            maxDrawdown: comparison.riskBudgeting.maxDrawdown.toFixed(2),
          },
          equalWeight: {
            return: comparison.equalWeight.annualizedReturn.toFixed(2),
            volatility: comparison.equalWeight.annualizedVolatility.toFixed(2),
            sharpe: comparison.equalWeight.sharpeRatio.toFixed(2),
            maxDrawdown: comparison.equalWeight.maxDrawdown.toFixed(2),
          },
        },
        stressTest: {
          worstPeriod: {
            start: worstPeriod.startDate,
            end: worstPeriod.endDate,
            loss: worstPeriod.loss.toFixed(2),
          },
        },
      },
    });
    
  } catch (error: any) {
    console.error("=== RISK BUDGETING API ERROR ===");
    console.error("Error message:", error.message);
    return NextResponse.json(
      { 
        error: error.message || "Failed to generate risk budgeting portfolio",
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

function quadraticFormFromCov(x: number[], cov: number[][]): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < x.length; j++) {
      sum += x[i] * cov[i][j] * x[j];
    }
  }
  return sum;
}