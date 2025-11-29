import { NextRequest, NextResponse } from "next/server";
import { runBacktest } from "@/lib/backtest";
import {
  calculateCovarianceMatrix,
  calculateReturns,
  calculateRiskContributions,
  calculateCorrelationMatrix,
  calculateAverageCorrelation,
} from "@/lib/riskBudgeting";

/**
 * REBALANCING DATA API
 * ====================
 * Calculates historical portfolio performance using FIXED weights.
 * Uses the SAME runBacktest() function as the risk-budgeting page.
 * 
 * Weights are maintained through quarterly rebalancing (not recalculated).
 */

export async function POST(req: NextRequest) {
  try {
    const { symbols, startDate, endDate, weights, lookbackPeriodYears } = await req.json();
    const normalizedLookbackYears =
      typeof lookbackPeriodYears === 'number' && lookbackPeriodYears > 0
        ? lookbackPeriodYears
        : 5;
    
    console.log('=== REBALANCING DATA API CALLED ===');
    console.log('Symbols:', symbols);
    console.log('Weights:', weights);
    console.log('Period:', startDate, 'to', endDate);

    const MS_IN_DAY = 24 * 60 * 60 * 1000;
    const MIN_SECONDS = 24 * 60 * 60;
    const creationDate = new Date(startDate);
    const requestedEnd = new Date(endDate);
    const historicalStart = new Date(creationDate);
    historicalStart.setFullYear(historicalStart.getFullYear() - normalizedLookbackYears);

    // Guard against invalid ranges (e.g. portfolio just created this second)
    if (requestedEnd.getTime() <= creationDate.getTime()) {
      requestedEnd.setTime(creationDate.getTime() + MS_IN_DAY);
    }

    const period1 = Math.floor(historicalStart.getTime() / 1000);
    const rawPeriod2 = Math.floor(requestedEnd.getTime() / 1000);
    const period2 = Math.max(rawPeriod2, period1 + MIN_SECONDS);

    const insufficientHistoryResponse = (message: string) =>
      NextResponse.json(
        {
          rebalancingData: [],
          portfolioValues: [],
          dates: [],
          mostRecentDate: null,
          initialDate: startDate,
          initialPrices: {},
          todaysPrices: {},
          currentRiskContributions: {},
          insufficientHistory: true,
          message,
        },
        { status: 200 }
      );
    
    // STEP 1: Fetch historical daily prices and dividends from Yahoo Finance
    const historicalDataPromises = symbols.map(async (symbol: string) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d&events=div`;
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      if (!response.ok) {
        console.warn(`Failed to fetch ${symbol}`);
        return { symbol, prices: [], dates: [], dividends: [] };
      }
      
      const data = await response.json();
      const result = data.chart?.result?.[0];
      
      if (!result) return { symbol, prices: [], dates: [], dividends: [] };
      
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const dividendEvents = result.events?.dividends || {};
      
      // Create dividend map: timestamp -> dividend amount
      const dividendMap = new Map<number, number>();
      for (const [timestamp, divData] of Object.entries(dividendEvents)) {
        dividendMap.set(parseInt(timestamp), (divData as any).amount || 0);
      }
      
      const prices: number[] = [];
      const dates: string[] = [];
      const dividends: number[] = [];
      
      for (let i = 0; i < closes.length; i++) {
        if (closes[i] !== null && closes[i] !== undefined) {
          prices.push(closes[i]);
          dates.push(new Date(timestamps[i] * 1000).toISOString().split('T')[0]);
          dividends.push(dividendMap.get(timestamps[i]) || 0);
        }
      }
      
      return { symbol, prices, dates, dividends };
    });
    
    const allData = await Promise.all(historicalDataPromises);
    
    console.log('Fetched data for', allData.length, 'symbols');
    
    // STEP 2: Align data to common dates
    const allDates = new Set<string>();
    allData.forEach(d => d.dates.forEach((date: string) => allDates.add(date)));
    const commonDates = Array.from(allDates).sort();
    
    const pricesMap = new Map<string, number[]>();
    const dividendsMap = new Map<string, number[]>();
    
    allData.forEach(({ symbol, prices, dates, dividends }) => {
      const dateToPrice = new Map(dates.map((d: string, i: number) => [d, prices[i]]));
      const dateToDividend = new Map(dates.map((d: string, i: number) => [d, dividends[i]]));
      
      const alignedPrices: number[] = [];
      const alignedDividends: number[] = [];
      
      for (const date of commonDates) {
        const price = dateToPrice.get(date);
        if (price !== undefined) {
          alignedPrices.push(price as number);
          alignedDividends.push((dateToDividend.get(date) as number) || 0);
        }
      }
      
      if (alignedPrices.length > 0) {
        pricesMap.set(symbol, alignedPrices);
        dividendsMap.set(symbol, alignedDividends);
      }
    });
    
    console.log('Aligned to', commonDates.length, 'common dates');
    
    // Validate we have data for all symbols
    if (commonDates.length === 0) {
      return insufficientHistoryResponse(
        'Not enough market data is available between the portfolio creation date and today. Try again after the next market close.'
      );
    }
    
    for (const symbol of symbols) {
      const prices = pricesMap.get(symbol);
      if (!prices || prices.length === 0) {
        return insufficientHistoryResponse(
          `No price data available for ${symbol} in the specified date range. This could happen if the asset is newly listed.`
        );
      }
    }
    
    const creationDateISO = creationDate.toISOString().split('T')[0];
    let sliceStartIdx = commonDates.findIndex(date => date >= creationDateISO);
    if (sliceStartIdx === -1) {
      // No trading data on/after creation date yet (e.g., same-day creation before close),
      // so anchor the slice to the latest available close.
      sliceStartIdx = commonDates.length - 1;
    }
    
    // STEP 3: Run backtest with fixed weights (SAME as risk-budgeting page)
    const targetWeights = weights.map((w: number) => w / 100);
    
    const backtest = runBacktest(
      pricesMap,
      dividendsMap,
      commonDates,
      targetWeights,
      symbols,
      { frequency: 'quarterly', transactionCost: 0.001 },
      10000,
      true,
      undefined,
      normalizedLookbackYears,
      false,
      "erc",
      sliceStartIdx
    );
    
    console.log('Backtest completed');
    console.log('Final value:', backtest.finalValue);
    console.log('Rebalancing events:', backtest.rebalanceDates?.length);
    
    // STEP 4: Format rebalancing events
    const rebalancingData = backtest.rebalanceDates?.map((rebalance, idx) => ({
      date: rebalance.date,
      portfolioValue: rebalance.portfolioValue.toFixed(2),
      weightChanges: rebalance.changes,
      qtrReturn: rebalance.quarterlyReturn?.toFixed(2) || "0.00",
      vol: rebalance.volatility?.toFixed(2) || "0.00",
      sharpe: rebalance.sharpe?.toFixed(2) || "0.00",
      totalTradingVolume: rebalance.totalTradingVolume !== undefined ? rebalance.totalTradingVolume.toFixed(2) : "0.00",
      transactionCost: rebalance.transactionCost !== undefined ? rebalance.transactionCost.toFixed(2) : "0.00",
      totalRebalancePct: rebalance.totalRebalancePct !== undefined ? rebalance.totalRebalancePct.toFixed(2) : "0.00",
      // Store prices at this rebalance date for drift calculation
      pricesAtRebalance: symbols.reduce((acc: Record<string, number>, symbol: string) => {
        const prices = pricesMap.get(symbol);
        if (prices && commonDates) {
          const dateIndex = commonDates.indexOf(rebalance.date);
          if (dateIndex >= 0 && dateIndex < prices.length) {
            acc[symbol] = prices[dateIndex];
          }
        }
        return acc;
      }, {} as Record<string, number>),
      // Store risk contribution at rebalance (from ERC optimization)
      riskContributions: rebalance.changes.reduce((acc: Record<string, number>, change: any) => {
        // In ERC portfolios, risk contribution ≈ weight at rebalance
        acc[change.symbol || change.ticker] = parseFloat(change.afterWeight);
        return acc;
      }, {} as Record<string, number>),
      // Add dividend data on the last rebalancing event
      dividendCash: idx === (backtest.rebalanceDates?.length || 0) - 1 
        ? backtest.dividendCash 
        : undefined,
      shadowPortfolioValue: idx === (backtest.rebalanceDates?.length || 0) - 1
        ? backtest.shadowPortfolioValue
        : undefined,
      shadowDividendCash: idx === (backtest.rebalanceDates?.length || 0) - 1
        ? backtest.dividendCashIfReinvested
        : undefined,
    })) || [];

    // STEP 5: Capture initial and most recent price snapshots
    let mostRecentDate = commonDates[commonDates.length - 1];
    const todaysPrices: Record<string, number> = {};
    const initialPrices: Record<string, number> = {};
    symbols.forEach((symbol: string) => {
      const prices = pricesMap.get(symbol);
      if (prices && prices.length > 0) {
        todaysPrices[symbol] = prices[prices.length - 1];
        const initIdx = Math.min(Math.max(sliceStartIdx, 0), prices.length - 1);
        initialPrices[symbol] = prices[initIdx];
      }
    });
    const initialDate = commonDates[Math.min(sliceStartIdx, commonDates.length - 1)];

    // If the portfolio is brand new and the market hasn't produced a close AFTER creation yet,
    // keep today's prices equal to the initial snapshot so both charts match.
    const hasPostCreationClose =
      new Date(mostRecentDate).getTime() > new Date(creationDateISO).getTime();
    if (!hasPostCreationClose) {
      mostRecentDate = initialDate;
      for (const symbol of Object.keys(initialPrices)) {
        todaysPrices[symbol] = initialPrices[symbol];
      }
    }

    // STEP 6: Calculate drifted weights using latest prices
    const basePortfolioValue = 10000;
    const currentValues = symbols.map((symbol, idx) => {
      const basePrice = initialPrices[symbol];
      const latestPrice = todaysPrices[symbol];
      const targetWeight = targetWeights[idx] ?? 0;
      if (
        typeof basePrice === "number" &&
        basePrice > 0 &&
        typeof latestPrice === "number" &&
        latestPrice > 0
      ) {
        const shares = (basePortfolioValue * targetWeight) / basePrice;
        return shares * latestPrice;
      }
      return basePortfolioValue * targetWeight;
    });
    const totalCurrentValue = currentValues.reduce((sum, val) => sum + val, 0);
    const driftedWeights =
      totalCurrentValue > 0
        ? currentValues.map((val) => val / totalCurrentValue)
        : [...targetWeights];

    // Build covariance/correlation matrices over the requested lookback window
    let driftedRiskContributions: Record<string, number> = {};
    let covarianceMatrix: number[][] | undefined;
    let correlationMatrix: number[][] | undefined;
    let avgCorrelation: string | undefined;
    // Preserve high precision drifted weights (decimals) and a rounded % view
    const driftedWeightsRaw = driftedWeights.map((w) => Number(w ?? 0));
    const driftedWeightsPct = driftedWeights.map((w) =>
      parseFloat(((w ?? 0) * 100).toFixed(4))
    );

    try {
      const lookbackWindowDays = Math.max(1, normalizedLookbackYears * 252);
      const covStartIdx = Math.max(0, commonDates.length - lookbackWindowDays);
      const returnsData = symbols.map((symbol) => {
        const series = pricesMap.get(symbol) || [];
        const window = series.slice(covStartIdx);
        if (window.length < 2) {
          throw new Error(`Insufficient price history for ${symbol}`);
        }
        return calculateReturns(window);
      });

      covarianceMatrix = calculateCovarianceMatrix(returnsData);
      correlationMatrix = calculateCorrelationMatrix(covarianceMatrix);
      avgCorrelation = calculateAverageCorrelation(correlationMatrix);

      const { contributions } = calculateRiskContributions(
        driftedWeights,
        covarianceMatrix
      );
      const total = contributions.reduce((sum, rc) => sum + (rc || 0), 0);
      symbols.forEach((symbol, idx) => {
        const contrib = contributions[idx];
        const pct =
          total !== 0 && Number.isFinite(contrib)
            ? (contrib / total) * 100
            : (driftedWeights[idx] ?? 0) * 100;
        driftedRiskContributions[symbol] = parseFloat(pct.toFixed(2));
      });
    } catch (err) {
      console.warn("Unable to build covariance matrix for drifted RC:", err);
      symbols.forEach((symbol, idx) => {
        driftedRiskContributions[symbol] = parseFloat(
          ((driftedWeights[idx] ?? targetWeights[idx] ?? 0) * 100).toFixed(2)
        );
      });
    }

    return NextResponse.json({
      rebalancingData,
      portfolioValues: backtest.portfolioValues,
      dates: backtest.dates,
      mostRecentDate,
      initialDate,
      initialPrices,
      todaysPrices, // Today's closing prices for drift calculation
      currentRiskContributions: driftedRiskContributions,
      covarianceMatrix,
      correlationMatrix,
      avgCorrelation,
      driftedWeights: driftedWeightsPct,
      driftedWeightsRaw,
    });
    
  } catch (error: any) {
    console.error('Error calculating rebalancing data:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate rebalancing data' },
      { status: 500 }
    );
  }
}
