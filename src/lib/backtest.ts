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
    tradeAmount?: number;
  }[];
  totalTradingVolume?: number;
  transactionCost?: number;
  pricesAtRebalance?: Record<string, number>;
  riskContributions?: Record<string, number>;
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
  dividendCash?: number;
  dividendCashIfReinvested?: number;
  missedDividendOpportunity?: number;
  shadowPortfolioValue?: number;
  shadowTotalReturn?: number;
  currentRiskContributions?: Record<string, number>;
}

export interface RebalanceConfig {
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  transactionCost: number;
}


/**
 * RUN HISTORICAL BACKTEST
 */
export function runBacktest(
  pricesMap: Map<string, number[]>,
  dividendsMap: Map<string, number[]>,
  dates: string[],
  initialWeights: number[],
  tickers: string[],
  rebalanceConfig: RebalanceConfig,
  initialValue: number = 10000,
  reinvestDividends: boolean = true,
  targetBudgets?: number[],
  lookbackPeriodYears?: number,
  maintainFixedWeights: boolean = false,
  optimizer: "erc" | "es" = "erc",
  outputStartIdx: number = 0
): BacktestResult {

  // ==== SAFETY CHECK ====
  const n = dates.length;
  if (n < 2) {
    const safeWeights: Record<string, number> = {};
    tickers.forEach((t,i)=> safeWeights[t] = initialWeights[i]*100);

    return {
      portfolioValues:[initialValue],
      returns:[],
      dates,
      finalValue: initialValue,
      totalReturn:0,
      annualizedReturn:0,
      annualizedVolatility:0,
      sharpeRatio:0,
      maxDrawdown:0,
      maxDrawdownPeriod:{start:"",end:""},
      rebalanceCount:0,
      currentRiskContributions: safeWeights,
    };
  }

  const sliceStart = Math.max(0,Math.min(outputStartIdx,n-1));
  let dividendCashAtSliceStart = 0;
  let dividendCashIfReinvestedAtSliceStart = 0;
  let shadowValueAtSliceStart = 0;

  const portfolioValues = [initialValue];
  const returns: number[] = [];
  let totalDividendCash = 0;
  let totalDividendCashIfReinvested = 0;

  // Track dynamic weights and shares
  let currentWeights = [...initialWeights];
  let previousTargetWeights = [...initialWeights];

  const shares = currentWeights.map((w,i)=>{
    const prices = pricesMap.get(tickers[i])!;
    return prices[0] > 0 ? (initialValue*w)/prices[0] : 0;
  });

  const shadowShares = [...shares];

  let rebalanceCount = 0;
  let lastRebalanceDate = dates[0];
  const rebalanceEvents: RebalanceEvent[] = [];


  // ==== MAIN SIMULATION LOOP ====
  for (let t=1; t<n; t++){

    // ---- 1. Dividends ----
    let cashFromDividends = 0;

    tickers.forEach((ticker,i)=>{
      const divs = dividendsMap.get(ticker)!;
      const div = divs[t];

      if(div > 0){
        const divCash = shares[i]*div;
        totalDividendCash += divCash;

        if(reinvestDividends){
          const price = pricesMap.get(ticker)![t-1];
          if(price > 0){
            shares[i] += divCash/price;
          }
        } else {
          cashFromDividends += divCash;
        }

        // shadow portfolio
        const shadowDiv = shadowShares[i]*div;
        const price = pricesMap.get(ticker)![t-1];

        if(reinvestDividends){
          totalDividendCashIfReinvested += shadowDiv;
        } else {
          totalDividendCashIfReinvested += shadowDiv;
          if(price>0){
            shadowShares[i] += shadowDiv/price;
          }
        }
      }
    });

    // ---- 2. Portfolio value ----
    let portfolioValue = cashFromDividends;
    tickers.forEach((ticker,i)=>{
      const price = pricesMap.get(ticker)![t];
      portfolioValue += shares[i]*price;
    });

    // ---- 3. Daily return ----
    const prevVal = portfolioValues[portfolioValues.length-1];
    const dailyReturn = prevVal>0 ? (portfolioValue-prevVal)/prevVal : 0;
    returns.push(dailyReturn);
    portfolioValues.push(portfolioValue);

    if(t===sliceStart){
      dividendCashAtSliceStart = totalDividendCash;
      dividendCashIfReinvestedAtSliceStart = totalDividendCashIfReinvested;
      shadowValueAtSliceStart = tickers.reduce((s,tick,i)=>{
        const p = pricesMap.get(tick)![t];
        return s + shadowShares[i]*p;
      },0);
    }

    // ---- 4. REBALANCING ----
    const lookbackDays = lookbackPeriodYears ? lookbackPeriodYears*252 : 252;

    if(shouldRebalance(dates[t], lastRebalanceDate, rebalanceConfig.frequency)){

      const window = Math.min(lookbackDays,t);
      const startIdx = Math.max(0, t-window);

      let newTargetWeights: number[] = [];

      if(maintainFixedWeights){
        newTargetWeights = [...initialWeights];
      } else {
        try {

          // extract recent returns
          const recentReturnsData: number[][] = [];
          for(const tick of tickers){
            const prices = pricesMap.get(tick)!;
            const segment = prices.slice(startIdx,t+1);
            if(segment.length<2) throw new Error("No data");
            recentReturnsData.push( calculateReturns(segment) );
          }

          const recentCovMatrix = calculateCovarianceMatrix(recentReturnsData);

          // =========== **UPDATED ES MODEL** ===========
          if(optimizer === "es"){

            // μ is NOT used by pure ES-risk-parity,
            // but we pass dummy vector to satisfy interface.
            const muDummy = new Array(tickers.length).fill(0);

            const esOpt = optimizeExpectedShortfall({
              mu: muDummy,
              sigma: recentCovMatrix,
              budgets: targetBudgets,
              budgetStrength: 400,
            });

            newTargetWeights = esOpt.weights;

          } else {
            // unchanged ERC logic
            const ercOpt = optimizeERC(recentCovMatrix,1000,1e-6,targetBudgets);
            newTargetWeights = ercOpt.weights;
          }
          // ============================================

        } catch(e){
          newTargetWeights = [...currentWeights];
        }
      }

      // Update current weights
      currentWeights = newTargetWeights;

      // ---- compute pre-rebalance drifted weights ----
      const currentWeightsBeforeRebalance = tickers.map((tick,i)=>{
        const price = pricesMap.get(tick)![t];
        const assetVal = shares[i]*price;
        return (assetVal/portfolioValue)*100;
      });

      // ---- rolling vol, Sharpe ----
      const win = Math.min(252, returns.length);
      const r = returns.slice(-win);
      const mean = r.reduce((s,v)=>s+v,0)/ (r.length || 1);
      const variance = r.reduce((s,v)=>s+(v-mean)*(v-mean),0)/(r.length||1);

      const rollingVol = Math.sqrt(variance*252)*100;
      const annualizedMeanReturn = mean*252*100;
      const rollingSharpe = rollingVol>0 ? annualizedMeanReturn/rollingVol : 0;

      // ---- quarterly return ----
      const qWin = Math.min(60, portfolioValues.length);
      const qStartVal = portfolioValues[portfolioValues.length-qWin];
      const qEndVal = portfolioValue;
      const quarterlyReturn = qStartVal>0 ? ((qEndVal-qStartVal)/qStartVal)*100 : 0;

      // ---- trading volume ----
      let totalTradingVolume = 0;
      tickers.forEach((tick,i)=>{
        const price = pricesMap.get(tick)![t];
        const curVal = shares[i]*price;
        const targetVal = portfolioValue*currentWeights[i];
        totalTradingVolume += Math.abs(targetVal-curVal);
      });

      const transactionCost = totalTradingVolume*rebalanceConfig.transactionCost;
      const portAfterCost = portfolioValue - transactionCost;

      // ---- apply rebalance ----
      tickers.forEach((tick,i)=>{
        const price = pricesMap.get(tick)![t];
        const targetVal = portAfterCost*currentWeights[i];
        shares[i] = price>0 ? targetVal/price : 0;
      });

      portfolioValue = portAfterCost;
      portfolioValues[portfolioValues.length-1] = portfolioValue;

      // ---- shadow portfolio ----
      let shadowVal = 0;
      tickers.forEach((tick,i)=>{
        const price = pricesMap.get(tick)![t];
        shadowVal += shadowShares[i]*price;
      });

      const shadowTradingVolume = tickers.reduce((s,tick,i)=>{
        const price = pricesMap.get(tick)![t];
        const curVal = shadowShares[i]*price;
        const targetVal = shadowVal*currentWeights[i];
        return s + Math.abs(targetVal-curVal);
      },0);

      const shadowCost = shadowTradingVolume*rebalanceConfig.transactionCost;
      const shadowAfterCost = shadowVal-shadowCost;

      tickers.forEach((tick,i)=>{
        const price = pricesMap.get(tick)![t];
        const targetVal = shadowAfterCost*currentWeights[i];
        shadowShares[i] = price>0 ? targetVal/price : 0;
      });


      // ---- log event ----
      const pricesAtRebalance: Record<string,number> = {};
      tickers.forEach((tick,i)=>{
        pricesAtRebalance[tick] = parseFloat(pricesMap.get(tick)![t].toFixed(4));
      });

      const riskSnapshot: Record<string,number> = {};
      tickers.forEach((tick,i)=>{
        riskSnapshot[tick] = parseFloat((currentWeights[i]*100).toFixed(2));
      });

      rebalanceEvents.push({
        date: dates[t],
        portfolioValue: parseFloat(portfolioValue.toFixed(2)),
        volatility: parseFloat(rollingVol.toFixed(2)),
        sharpe: parseFloat(rollingSharpe.toFixed(2)),
        quarterlyReturn: parseFloat(quarterlyReturn.toFixed(2)),
        totalTradingVolume: parseFloat(totalTradingVolume.toFixed(2)),
        transactionCost: parseFloat(transactionCost.toFixed(2)),
        changes: tickers.map((tick,i)=>{
          const price = pricesMap.get(tick)![t];
          const curVal = shares[i]*price;
          const targetVal = portfolioValue*currentWeights[i];
          const tradeAmount = Math.abs(targetVal-curVal);

          return {
            ticker: tick,
            beforeWeight: parseFloat(currentWeightsBeforeRebalance[i].toFixed(2)),
            afterWeight: parseFloat((currentWeights[i]*100).toFixed(2)),
            drift: parseFloat((currentWeightsBeforeRebalance[i] - previousTargetWeights[i]*100).toFixed(2)),
            tradeAmount: parseFloat(tradeAmount.toFixed(2)),
          };
        }),
        pricesAtRebalance,
        riskContributions: riskSnapshot,
      });

      previousTargetWeights = [...currentWeights];
      rebalanceCount++;
      lastRebalanceDate = dates[t];
    }
  }


  // ==== DRIFTED RISK CONTRIBUTIONS (end-of-simulation) ====
  let currentRiskContributions: Record<string,number> = {};
  let finalDriftedWeights: number[] = [];

  try {
    const iFinal = dates.length-1;

    const finalPrices = tickers.map(tick=>{
      const arr = pricesMap.get(tick)!;
      return arr[iFinal];
    });

    const finalVals = shares.map((sh,i)=>sh*finalPrices[i]);
    const totFinal = finalVals.reduce((a,b)=>a+b,0) || 1;

    finalDriftedWeights = finalVals.map(v=>v/totFinal);

    const lookbackDays = lookbackPeriodYears ? lookbackPeriodYears*252 : 252;
    const start = Math.max(0, dates.length - lookbackDays);

    const recentReturnsData: number[][] = [];

    let valid = true;
    for(const tick of tickers){
      const prices = pricesMap.get(tick)!;
      const slice = prices.slice(start);
      if(slice.length<2){ valid=false; break; }
      recentReturnsData.push( calculateReturns(slice) );
    }

    if(valid){
      const cov = calculateCovarianceMatrix(recentReturnsData);
      const { contributions } = calculateRiskContributions(finalDriftedWeights,cov);

      const absSum = contributions.reduce((s,v)=>s+Math.abs(v),0);

      tickers.forEach((tick,i)=>{
        const rcPct = absSum>0
          ? (Math.abs(contributions[i])/absSum)*100
          : finalDriftedWeights[i]*100;
        currentRiskContributions[tick] = parseFloat(rcPct.toFixed(2));
      });

    } else {
      tickers.forEach((tick,i)=>{
        currentRiskContributions[tick] = parseFloat((finalDriftedWeights[i]*100).toFixed(2));
      });
    }

  } catch(e){
    tickers.forEach((tick,i)=>{
      currentRiskContributions[tick] = parseFloat((finalDriftedWeights[i]*100).toFixed(2));
    });
  }


  // ==== BURN-IN WINDOW ====
  let outDates = dates;
  let outValues = portfolioValues;
  let scale=1;

  if(sliceStart>0 && sliceStart<portfolioValues.length){
    outDates = dates.slice(sliceStart);

    const baseVal = portfolioValues[sliceStart];
    scale = baseVal>0 ? initialValue/baseVal : 1;

    outValues = portfolioValues.slice(sliceStart).map(v=>v*scale);
  }

  const outReturns: number[] = [];
  for(let i=1;i<outValues.length;i++){
    outReturns.push(outValues[i-1]>0 ? outValues[i]/outValues[i-1]-1 : 0);
  }

  const outSet = new Set(outDates);
  const outRebalanceEvents = sliceStart>0
    ? rebalanceEvents.filter(ev=>outSet.has(ev.date)).map(ev=>({
        ...ev,
        portfolioValue: parseFloat((ev.portfolioValue*scale).toFixed(2)),
        totalTradingVolume: ev.totalTradingVolume !== undefined
          ? parseFloat((ev.totalTradingVolume*scale).toFixed(2))
          : ev.totalTradingVolume,
        transactionCost: ev.transactionCost !== undefined
          ? parseFloat((ev.transactionCost*scale).toFixed(2))
          : ev.transactionCost,
        changes: ev.changes.map(ch=>({
          ...ch,
          tradeAmount: ch.tradeAmount!==undefined
            ? parseFloat((ch.tradeAmount*scale).toFixed(2))
            : ch.tradeAmount,
        })),
      }))
    : rebalanceEvents;


  const rebalanceCountOut = outRebalanceEvents.length;

  const windowDiv = totalDividendCash - dividendCashAtSliceStart;
  const windowDivIfRe = totalDividendCashIfReinvested - dividendCashIfReinvestedAtSliceStart;

  const finalValue = outValues.length>0 ? outValues[outValues.length-1] : initialValue;
  const totalReturn = (finalValue-initialValue)/initialValue;

  const years = (outValues.length-1)/252;
  const annualizedReturn = years>0 ? Math.pow(1+totalReturn,1/years)-1 : 0;

  const meanRet = outReturns.reduce((s,v)=>s+v,0)/(outReturns.length||1);
  const varRet = outReturns.reduce((s,v)=>s+(v-meanRet)*(v-meanRet),0)/(outReturns.length||1);
  const annualizedVol = Math.sqrt(varRet*252);

  const sharpe = annualizedVol>0 ? annualizedReturn/annualizedVol : 0;

  const { maxDD, peakIndex, troughIndex } = calculateDrawdownFromValues(outValues);

  // shadow final value
  let shadowVal = 0;
  tickers.forEach((tick,i)=>{
    const arr = pricesMap.get(tick)!;
    const last = arr[arr.length-1];
    shadowVal += shadowShares[i]*last;
  });

  let windowShadowVal = shadowVal;
  if(sliceStart>0 && shadowValueAtSliceStart>0){
    windowShadowVal = (shadowVal/shadowValueAtSliceStart)*initialValue;
  }

  const windowShadowReturn = ((windowShadowVal-initialValue)/initialValue)*100;

  const missedOpp = reinvestDividends
    ? (finalValue-windowShadowVal)
    : (windowShadowVal-finalValue);

  return {
    portfolioValues: outValues,
    returns: outReturns,
    dates: outDates,
    finalValue,
    totalReturn: totalReturn*100,
    annualizedReturn: annualizedReturn*100,
    annualizedVolatility: annualizedVol*100,
    sharpeRatio: sharpe,
    maxDrawdown: -Math.abs(maxDD),
    maxDrawdownPeriod:{
      start: outDates[peakIndex] || "",
      end: outDates[troughIndex] || "",
    },
    rebalanceCount: rebalanceCountOut,
    rebalanceDates: outRebalanceEvents,
    dividendCash: windowDiv,
    dividendCashIfReinvested: windowDivIfRe,
    missedDividendOpportunity: missedOpp,
    shadowPortfolioValue: windowShadowVal,
    shadowTotalReturn: windowShadowReturn,
    currentRiskContributions,
  };
}


/**
 * CHECK REBALANCE FREQUENCY
 */
function shouldRebalance(currentDate: string, lastRebalanceDate: string, freq: RebalanceConfig["frequency"]): boolean {
  const c = new Date(currentDate);
  const l = new Date(lastRebalanceDate);

  switch(freq){
    case "daily": return true;
    case "weekly": return c.getTime()-l.getTime() >= 7*24*60*60*1000;
    case "monthly": return c.getMonth()!==l.getMonth() || c.getFullYear()!==l.getFullYear();
    case "quarterly":
      return Math.floor(c.getMonth()/3)!==Math.floor(l.getMonth()/3) ||
             c.getFullYear()!==l.getFullYear();
    case "annually":
      return c.getFullYear()!==l.getFullYear();
    default:
      return false;
  }
}


/**
 * MAX DRAWDOWN
 */
function calculateDrawdownFromValues(values: number[]): {
  maxDD: number;
  peakIndex: number;
  troughIndex: number;
} {
  let maxDD = 0;
  let peak = values[0];
  let peakIndex = 0;
  let maxPeak=0;
  let maxTrough=0;

  for(let i=0;i<values.length;i++){
    if(values[i]>peak){
      peak = values[i];
      peakIndex=i;
    }
    const dd = (peak-values[i])/peak;
    if(dd>maxDD){
      maxDD = dd;
      maxPeak = peakIndex;
      maxTrough=i;
    }
  }

  return {
    maxDD:maxDD*100,
    peakIndex:maxPeak,
    troughIndex:maxTrough,
  };
}


/**
 * STRESS TEST VOL
 */
export function stressTestVolatility(cov:number[][], scale:number): number[][]{
  return cov.map(row=>row.map(v=>v*scale));
}


/**
 * FIND WORST PERIOD
 */
export function findWorstPeriod(
  portfolioValues: number[],
  dates: string[],
  windowDays: number = 30
){
  let worstLoss = 0;
  let ws=0, we=0;

  for(let i=0;i<portfolioValues.length-windowDays;i++){
    const start = portfolioValues[i];
    const end = portfolioValues[i+windowDays];
    const loss = start>0 ? (end-start)/start : 0;
    if(loss < worstLoss){
      worstLoss = loss;
      ws=i;
      we=i+windowDays;
    }
  }

  return {
    startIndex:ws,
    endIndex:we,
    loss:worstLoss*100,
    startDate:dates[ws]||"",
    endDate:dates[we]||"",
  };
}


/**
 * COMPARE STRATEGIES
 */
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
  optimizer: "erc" | "es" = "erc",
  outputStartIdx: number = 0
){
  const riskBudgeting = runBacktest(
    pricesMap, dividendsMap, dates,
    riskBudgetWeights, tickers,
    rebalanceConfig, 10000, reinvestDividends,
    targetBudgets, lookbackPeriodYears,
    false,
    optimizer, outputStartIdx
  );

  const equalW = Array(tickers.length).fill(1/tickers.length);
  const equalWeight = runBacktest(
    pricesMap, dividendsMap, dates,
    equalW, tickers,
    rebalanceConfig, 10000, reinvestDividends,
    undefined, lookbackPeriodYears,
    true,
    optimizer, outputStartIdx
  );

  return { riskBudgeting, equalWeight };
}
