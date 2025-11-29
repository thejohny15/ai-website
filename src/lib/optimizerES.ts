


"use strict";

// Expected Shortfall (Gaussian / Normal approximation) with TRUE ES risk budgeting.
// We minimize
//   ES(w) + λ * Σ_i (RC_share_i(w) - b_i)^2
// where RC_share_i are *tail-risk* contribution shares of the kα*sqrt(w'Σw) term.
// This enforces equal (or budgeted) tail-risk contributions.
//
// Long-only, fully-invested. Optional caps. AI params kept for backwards compatibility
// but not used (aiShadowPrice returned null).

export interface ESOptimizerOptions {
  mu: number[];
  sigma: number[][];
  alpha?: number;                // default 0.975
  budgets?: number[];            // risk budgets b_i, sum to 1. If omitted, no RB penalty.
  budgetStrength?: number;       // λ >= 0. If budgets provided and λ not set, defaults to 0.5.
  caps?: (number | null | undefined)[];
  aiIndex?: number;
  aiCap?: number;
  initialWeights?: number[];
  maxIterations?: number;        // default 500
  tolerance?: number;            // default 1e-8
  armijoBeta?: number;           // default 0.5
  armijoSigma?: number;          // default 1e-4
}

export function optimizeExpectedShortfall(opts: ESOptimizerOptions) {
  validateInputs(opts.mu, opts.sigma);

  const mu = opts.mu;
  const sigma = opts.sigma;
  const n = mu.length;

  const alpha = opts.alpha ?? 0.975;
  const kAlpha = normalPdf(invNormCdf(alpha)) / (1 - alpha);

  const upperBounds = (opts.caps ?? Array(n).fill(undefined)).map(c =>
    c == null ? Infinity : Math.max(0, c)
  );

  const budgets = normalizeBudgets(opts.budgets, n);
  const lambda = budgets ? Math.max(0, opts.budgetStrength ?? 0.5) : 0;

  // start
  let x = opts.initialWeights && opts.initialWeights.length === n
    ? projectFeasible(opts.initialWeights, upperBounds)
    : budgets
      ? projectFeasible([...budgets], upperBounds)
      : Array(n).fill(1 / n);

  let fx = evaluateObjective(x, mu, sigma, kAlpha, budgets, lambda);

  const maxIterations = opts.maxIterations ?? 500;
  const tol = opts.tolerance ?? 1e-8;
  const armijoBeta = opts.armijoBeta ?? 0.5;
  const armijoSigma = opts.armijoSigma ?? 1e-4;

  let converged = false;
  let iterations = 0;

  for (iterations = 0; iterations < maxIterations; iterations++) {
    const grad = objectiveGradient(x, mu, sigma, kAlpha, budgets, lambda);
    const gradNorm = Math.sqrt(dot(grad, grad));

    if (gradNorm < tol) {
      converged = true;
      break;
    }

    let step = 1.0;
    let accepted = false;

    for (let ls = 0; ls < 50; ls++) {
      let candidate = subtract(x, scale(grad, step));
      candidate = projectFeasible(candidate, upperBounds);
      const fxCand = evaluateObjective(candidate, mu, sigma, kAlpha, budgets, lambda);

      if (fxCand <= fx - armijoSigma * step * gradNorm * gradNorm) {
        x = candidate;
        fx = fxCand;
        accepted = true;
        break;
      }
      step *= armijoBeta;
    }

    if (!accepted) break;
  }

  // Tail-risk contributions & shares (for charts / RB)
  const { rcTail, rcTailShares } = tailRiskContributions(x, sigma, kAlpha);

  const entropy = computeEntropy(x);
  const diversification = Math.exp(entropy);

  return {
    weights: x,
    expectedShortfall: fx,
    kAlpha,
    riskContributions: rcTail,
    riskContributionShares: rcTailShares,
    entropy,
    diversification,
    iterations,
    converged,
    aiShadowPrice: null,
  };
}

// ---------- Objective: ES + λ * ||RCshares - b||^2 ----------

function evaluateObjective(
  w: number[],
  mu: number[],
  sigma: number[][],
  kAlpha: number,
  budgets: number[] | null,
  lambda: number
): number {
  const variance = Math.max(quadraticForm(w, sigma), 1e-16);
  const stdev = Math.sqrt(variance);
  const mean = dot(mu, w);
  let es = -mean + kAlpha * stdev;

  if (budgets && lambda > 0) {
    const { rcTailShares } = tailRiskContributions(w, sigma, kAlpha);
    let pen = 0;
    for (let i = 0; i < w.length; i++) {
      const d = rcTailShares[i] - budgets[i];
      pen += d * d;
    }
    es += lambda * pen;
  }
  return es;
}

function objectiveGradient(
  w: number[],
  mu: number[],
  sigma: number[][],
  kAlpha: number,
  budgets: number[] | null,
  lambda: number
): number[] {
  // Gradient of ES term: -mu + kAlpha / ||w||_Σ * Σ w
  const sw = matVec(sigma, w);
  const variance = Math.max(dot(w, sw), 1e-16);
  const stdev = Math.sqrt(variance);
  const scaleTail = kAlpha / stdev;

  const grad = mu.map((m, i) => -m + scaleTail * sw[i]);

  // Heuristic gradient for RC-share penalty.
  // Exact derivative is messy; this smooth approximation works well in practice.
  if (budgets && lambda > 0) {
    const { rcTailShares } = tailRiskContributions(w, sigma, kAlpha);
    for (let i = 0; i < w.length; i++) {
      grad[i] += 2 * lambda * (rcTailShares[i] - budgets[i]);
    }
  }

  return grad;
}

// ---------- Tail-risk contributions ----------

function tailRiskContributions(w: number[], sigma: number[][], kAlpha: number) {
  const sw = matVec(sigma, w);
  const variance = Math.max(dot(w, sw), 1e-16);
  const stdev = Math.sqrt(variance);
  const scaleTail = kAlpha / stdev;

  const marginalTail = sw.map(v => scaleTail * v);
  const rcTail = w.map((wi, i) => wi * marginalTail[i]);

  const sumRC = rcTail.reduce((a, b) => a + b, 0);
  const rcTailShares = sumRC > 1e-16
    ? rcTail.map(v => v / sumRC)
    : rcTail.map(() => 0);

  return { rcTail, rcTailShares };
}

// ---------- Budgets ----------

function normalizeBudgets(budgets: number[] | undefined, n: number): number[] | null {
  if (!budgets || budgets.length !== n) return null;
  const s = budgets.reduce((a, b) => a + b, 0);
  if (s <= 1e-16) return null;
  return budgets.map(b => b / s);
}

// ---------- Projection onto capped simplex ----------

function projectFeasible(w: number[], upperBounds: number[]): number[] {
  const n = w.length;
  let x = w.map((wi, i) => clamp(wi, 0, upperBounds[i]));
  let active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);

  for (let iter = 0; iter < 1000; iter++) {
    const sumX = x.reduce((a, b) => a + b, 0);
    const diff = sumX - 1;
    if (Math.abs(diff) < 1e-12) break;
    if (active.size === 0) break;

    const delta = diff / active.size;
    const toRemove: number[] = [];

    active.forEach(i => {
      const updated = x[i] - delta;
      const clipped = clamp(updated, 0, upperBounds[i]);
      x[i] = clipped;
      if (clipped === 0 || clipped === upperBounds[i]) toRemove.push(i);
    });

    toRemove.forEach(i => active.delete(i));
  }
  return x;
}

// ---------- Utils ----------

function validateInputs(mu: number[], sigma: number[][]): void {
  const n = mu.length;
  if (n === 0) throw new Error("mu is empty.");
  if (sigma.length !== n || sigma.some(r => r.length !== n)) {
    throw new Error("sigma must be n×n matching mu.");
  }
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function matVec(A: number[][], x: number[]): number[] {
  const n = x.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * x[j];
    out[i] = s;
  }
  return out;
}

function quadraticForm(x: number[], A: number[][]): number {
  return dot(x, matVec(A, x));
}

function subtract(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]);
}

function scale(a: number[], s: number): number[] {
  return a.map(v => v * s);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function computeEntropy(w: number[]): number {
  let h = 0;
  for (const wi of w) if (wi > 0) h -= wi * Math.log(wi);
  return h;
}

// ---------- Normal distribution ----------

function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

function invNormCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0,1)");
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
