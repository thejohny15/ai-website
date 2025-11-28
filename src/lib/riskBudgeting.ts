// filepath: /Users/johnjohn/my-ai-app/src/lib/riskBudgeting.ts

/**
 * Risk Budgeting & Equal Risk Contribution (ERC) Portfolio Optimization
 * 
 * This module implements the mathematical foundation for risk parity portfolios
 * where each asset contributes equally to total portfolio risk.
 */

interface HistoricalData {
  ticker: string;
  prices: number[];
  dates: string[];
}

interface OptimizationResult {
  weights: number[];
  riskContributions: number[];
  portfolioVolatility: number;
  converged: boolean;
  iterations: number;
}

/**
 * Calculate returns from price series
 * 
 * TOTAL RETURN = PRICE RETURN + DIVIDEND YIELD
 * 
 * Price Return: (P₁ - P₀) / P₀
 * Dividend Yield: D / P₀  (dividend paid between P₀ and P₁)
 * 
 * Example:
 * Day 0: Price = $100
 * Day 1: Price = $102, Dividend = $0.50
 * 
 * Price Return = (102 - 100) / 100 = 2.0%
 * Dividend Yield = 0.50 / 100 = 0.5%
 * Total Return = 2.0% + 0.5% = 2.5%
 * 
 * @param prices - Array of closing prices
 * @param dividends - Array of dividends paid (0 if no dividend on that day)
 * @returns Array of total returns (price return + dividend yield)
 */
export function calculateReturns(prices: number[], dividends?: number[]): number[] {
  const returns: number[] = [];
  
  // If no dividends provided, use price-only returns (backward compatible)
  if (!dividends || dividends.length === 0) {
    for (let i = 1; i < prices.length; i++) {
      // Price return: (P_t - P_{t-1}) / P_{t-1}
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }
  
  // Calculate TOTAL returns: (P_t - P_{t-1} + D_t) / P_{t-1}
  for (let i = 1; i < prices.length; i++) {
    const pt = prices[i];
    const ptPrev = prices[i - 1];
    const dt = dividends[i] || 0;
    const totalReturn = (pt - ptPrev + dt) / ptPrev;
    returns.push(totalReturn);
  }
  
  return returns;
}

/**
 * Calculate mean of an array
 */
function mean(arr: number[]): number {
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Calculate covariance matrix from returns data
 * Returns: n×n covariance matrix where n = number of assets
 */
export function calculateCovarianceMatrix(returnsData: number[][]): number[][] {
  const n = returnsData.length; // number of assets
  const T = returnsData[0].length; // number of observations
  
  // Calculate means
  const means = returnsData.map(returns => mean(returns));
  
  // Calculate covariance matrix
  const covMatrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let cov = 0;
      for (let t = 0; t < T; t++) {
        cov += (returnsData[i][t] - means[i]) * (returnsData[j][t] - means[j]);
      }
      covMatrix[i][j] = cov / (T - 1);
    }
  }
  
  // Annualize (assuming daily returns, 252 trading days)
  return covMatrix.map(row => row.map(val => val * 252));
}

/**
 * Matrix-vector multiplication
 */
function matrixVectorMultiply(matrix: number[][], vector: number[]): number[] {
  return matrix.map(row =>
    row.reduce((sum, val, i) => sum + val * vector[i], 0)
  );
}

/**
 * Calculate portfolio volatility
 * σ_p = √(w^T × Σ × w)
 */
export function calculatePortfolioVolatility(
  weights: number[],
  covMatrix: number[][]
): number {
  const wSigma = matrixVectorMultiply(covMatrix, weights);
  const variance = weights.reduce((sum, w, i) => sum + w * wSigma[i], 0);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Calculate risk contributions for each asset
 * RC_i = w_i × (Σ × w)_i / σ_p
 */
export function calculateRiskContributions(
  weights: number[],
  covMatrix: number[][]
): { contributions: number[]; percentages: number[] } {
  const portfolioVol = calculatePortfolioVolatility(weights, covMatrix);
  
  if (portfolioVol === 0) {
    return {
      contributions: weights.map(() => 0),
      percentages: weights.map(() => 0)
    };
  }
  
  const wSigma = matrixVectorMultiply(covMatrix, weights);
  const contributions = weights.map((w, i) => (w * wSigma[i]) / portfolioVol);
  
  const totalRC = contributions.reduce((sum, rc) => sum + rc, 0);
  const percentages = contributions.map(rc => (rc / totalRC) * 100);
  
  return { contributions, percentages };
}

/**
 * Optimize portfolio for Risk Budgeting using iterative algorithm
 * Based on Roncalli's cyclical coordinate descent method
 * 
 * @param covMatrix - Covariance matrix of asset returns
 * @param maxIterations - Maximum number of iterations
 * @param tolerance - Convergence tolerance
 * @param targetBudgets - Optional custom risk budgets (as decimals, must sum to 1). If not provided, uses equal risk contribution.
 */
export function optimizeERC(
  covMatrix: number[][],
  maxIterations: number = 1000,
  tolerance: number = 1e-6,
  targetBudgets?: number[]
): OptimizationResult {
  const n = covMatrix.length;
  
  // Validate target budgets if provided
  if (targetBudgets) {
    if (targetBudgets.length !== n) {
      throw new Error("Target budgets length must match number of assets");
    }
    const sum = targetBudgets.reduce((s, b) => s + b, 0);
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(`Target budgets must sum to 1. Current sum: ${sum}`);
    }
  }
  
  // Initialize with equal weights
  let weights = Array(n).fill(1 / n);
  
  let converged = false;
  let iteration = 0;
  
  // Use a more robust update with step size control
  const learningRate = 0.5; // Damping factor to prevent overshooting
  
  for (iteration = 0; iteration < maxIterations && !converged; iteration++) {
    const oldWeights = [...weights];
    
    // Calculate current risk contributions
    const wSigma = matrixVectorMultiply(covMatrix, weights);
    const portfolioVol = calculatePortfolioVolatility(weights, covMatrix);
    
    if (portfolioVol === 0) break;
    
    // Calculate target risk contributions
    const targetRCs = targetBudgets 
      ? targetBudgets.map(b => b * portfolioVol)
      : Array(n).fill(portfolioVol / n);
    
    // Update each weight using improved formula
    for (let i = 0; i < n; i++) {
      // Current marginal risk contribution
      const MRC_i = wSigma[i] / portfolioVol;
      
      // Current actual risk contribution
      const currentRC = weights[i] * MRC_i;
      
      // Calculate adjustment needed
      if (MRC_i > 0) {
        // New weight = old weight × (target RC / current RC)^learningRate
        const ratio = targetRCs[i] / currentRC;
        weights[i] = weights[i] * Math.pow(ratio, learningRate);
      }
    }
    
    // Normalize weights to sum to 1
    const sumWeights = weights.reduce((sum, w) => sum + w, 0);
    weights = weights.map(w => w / sumWeights);
    
    // Check convergence based on RISK CONTRIBUTION equality
    const { percentages } = calculateRiskContributions(weights, covMatrix);
    const targetPercentages = targetBudgets 
      ? targetBudgets.map(b => b * 100)  // Custom targets (already in %)
      : Array(n).fill(100 / n);           // Equal risk (25% for 4 assets)
    
    // Calculate max deviation from target
    const maxRCDeviation = Math.max(...percentages.map((rc, i) => Math.abs(rc - targetPercentages[i])));
    
    // Log progress every 100 iterations
    if (iteration % 100 === 0) {
      console.log(`Iteration ${iteration}: Max RC deviation = ${maxRCDeviation.toFixed(4)}%`);
    }
    
    // Converge when all risk contributions are within tolerance (in percentage points)
    if (maxRCDeviation < tolerance) {
      console.log(`✅ Converged at iteration ${iteration}: Max deviation = ${maxRCDeviation.toFixed(4)}%`);
      converged = true;
    }
  }
  
  if (!converged) {
    console.warn(`⚠️ Did not converge after ${maxIterations} iterations`);
  }
  
  // Calculate final risk contributions
  const { percentages } = calculateRiskContributions(weights, covMatrix);
  const portfolioVolatility = calculatePortfolioVolatility(weights, covMatrix);
  
  return {
    weights,
    riskContributions: percentages,
    portfolioVolatility,
    converged,
    iterations: iteration
  };
}

/**
 * Calculate portfolio expected return
 */
export function calculateExpectedReturn(
  weights: number[],
  meanReturns: number[]
): number {
  return weights.reduce((sum, w, i) => sum + w * meanReturns[i], 0) * 100; // as percentage
}

/**
 * Calculate Sharpe Ratio
 * Assuming risk-free rate = 0 for simplicity
 */
export function calculateSharpeRatio(
  expectedReturn: number,
  portfolioVol: number,
  riskFreeRate: number = 0
): number {
  if (portfolioVol === 0) return 0;
  return (expectedReturn - riskFreeRate) / (portfolioVol * 100);
}

/**
 * Calculate maximum drawdown from price series
 * 
 * Max Drawdown (MDD) measures the largest peak-to-trough decline in value.
 * 
 * Algorithm:
 * 1. Track the highest price seen so far (running peak)
 * 2. At each point, calculate drawdown = (peak - current) / peak
 * 3. MDD = maximum of all drawdowns
 * 
 * Example:
 * Prices: [100, 110, 105, 90, 95, 120]
 * Peak:   [100, 110, 110, 110, 110, 120]
 * DD:     [0%, 0%, 4.5%, 18.2%, 13.6%, 0%]
 * MDD = 18.2% (from 110 to 90)
 * 
 * Note: This is a simplified approximation for portfolio MDD.
 * For true portfolio MDD, you'd need to calculate weighted returns over time.
 * Currently we approximate by taking weighted average of individual asset MDD.
 * 
 * @param prices - Array of historical prices
 * @returns Maximum drawdown as a percentage
 */
export function calculateMaxDrawdown(prices: number[]): number {
  if (prices.length === 0) return 0;
  
  let maxDD = 0;
  let peak = prices[0];
  
  for (const price of prices) {
    // Update peak if we hit a new high
    if (price > peak) {
      peak = price;
    }
    
    // Calculate drawdown from peak
    const drawdown = (peak - price) / peak;
    
    // Track the maximum drawdown
    if (drawdown > maxDD) {
      maxDD = drawdown;
    }
  }
  
  return maxDD * 100; // as percentage
}

/**
 * Calculate maximum drawdown with detailed information
 * Returns the drawdown value, peak index, and trough index
 */
export function calculateMaxDrawdownDetailed(prices: number[]): {
  maxDD: number;
  peakIndex: number;
  troughIndex: number;
  peakValue: number;
  troughValue: number;
  recovery: boolean;
} {
  if (prices.length === 0) {
    return { maxDD: 0, peakIndex: 0, troughIndex: 0, peakValue: 0, troughValue: 0, recovery: false };
  }
  
  let maxDD = 0;
  let peak = prices[0];
  let peakIndex = 0;
  let maxDDPeakIndex = 0;
  let maxDDTroughIndex = 0;
  
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    
    if (price > peak) {
      peak = price;
      peakIndex = i;
    }
    
    const drawdown = (peak - price) / peak;
    
    if (drawdown > maxDD) {
      maxDD = drawdown;
      maxDDPeakIndex = peakIndex;
      maxDDTroughIndex = i;
    }
  }
  
  const peakValue = prices[maxDDPeakIndex];
  const troughValue = prices[maxDDTroughIndex];
  const currentValue = prices[prices.length - 1];
  const recovery = currentValue >= peakValue;
  
  return {
    maxDD: maxDD * 100,
    peakIndex: maxDDPeakIndex,
    troughIndex: maxDDTroughIndex,
    peakValue,
    troughValue,
    recovery,
  };
}

/**
 * Calculate correlation matrix from covariance matrix
 * 
 * Correlation = Cov(i,j) / (σ_i × σ_j)
 * 
 * @param covMatrix - Covariance matrix
 * @returns Correlation matrix (values between -1 and 1)
 */
export function calculateCorrelationMatrix(covMatrix: number[][]): number[][] {
  const n = covMatrix.length;
  const corrMatrix: number[][] = [];
  
  // Extract standard deviations (sqrt of diagonal elements)
  const stdDevs = covMatrix.map((row, i) => Math.sqrt(row[i]));
  
  // Calculate correlation for each pair
  for (let i = 0; i < n; i++) {
    corrMatrix[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        corrMatrix[i][j] = 1.0; // Perfect correlation with itself
      } else {
        // Correlation = Covariance / (σ_i × σ_j)
        corrMatrix[i][j] = covMatrix[i][j] / (stdDevs[i] * stdDevs[j]);
      }
    }
  }
  
  return corrMatrix;
}

/**
 * Calculate average correlation (excluding diagonal)
 * 
 * @param corrMatrix - Correlation matrix
 * @returns Average correlation between assets
 */
export function calculateAverageCorrelation(corrMatrix: number[][]): string {
  const n = corrMatrix.length;
  let sum = 0;
  let count = 0;
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += corrMatrix[i][j];
      count++;
    }
  }
  
  const avg = count > 0 ? sum / count : 0;
  return avg.toFixed(2);
}

/**
 * Ledoit–Wolf-style covariance shrinkage:
 * Σ_λ = (1 - λ) Σ̂ + λ diag(Σ̂)
 * 
 * @param sampleCov - sample covariance matrix Σ̂
 * @param lambda - shrinkage intensity in [0,1]
 */
export function shrinkCovariance(sampleCov: number[][], lambda: number = 0.1): number[][] {
  const n = sampleCov.length;
  if (n === 0) return sampleCov;
  const lambdaClamped = Math.min(Math.max(lambda, 0), 1);
  
  const shrunk: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const diag: number[] = sampleCov.map((row, i) => row[i]);
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const target = i === j ? diag[i] : 0;
      shrunk[i][j] = (1 - lambdaClamped) * sampleCov[i][j] + lambdaClamped * target;
    }
  }
  
  return shrunk;
}
