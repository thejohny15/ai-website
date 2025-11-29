// src/lib/portfolioStore.ts

export type Holding = { 
  symbol: string; 
  weight: number; 
  note?: string;
  recommendedShares?: number;
  estimatedPrice?: number;
  investmentAmount?: number;
};

export type Portfolio = {
  id: string;
  userId: string;
  name: string;
  createdAt: number;

  // Questionnaire
  riskTolerance?: "Conservative" | "Balanced" | "Aggressive";
  timeHorizon?: "0-2" | "3-5" | "6-10" | "10+";
  approximateValue?: number; // Cash available for investment (required for new portfolios, optional for backwards compatibility)
  currency?: "USD" | "EUR" | "GBP" | "CHF" | "JPY";
  exchanges?: string[];
  focus?: string;
  rebalancing?: "Monthly" | "Quarterly" | "Annually" | "On-demand";
  targetHoldings?: number;

  // Results (optional)
  proposalSummary?: any;         // string or object (Option 1/2)
  proposalHoldings?: Holding[];  // saved draft/final

  // Rebalancing fields
  rebalancingHistory?: string[]; // Array of ISO date strings when portfolio was rebalanced
  rebalancingFrequency?: 'monthly' | 'quarterly' | 'annually'; // How often to rebalance
  lastRebalanceDate?: string; // ISO date string of last rebalance

  // Backtest period (for matching full-analysis historical performance)
  backtestStartDate?: string; // Start date of backtest period from portfolio generation
  backtestEndDate?: string; // End date of backtest period from portfolio generation
  
  // Backtest results (saved from /api/risk-budgeting)
  backtestResults?: {
    portfolioValues: number[];
    dates: string[];
    finalValue: number;
    totalReturn: number;
    annualizedReturn: number;
    annualizedVolatility: number;
    sharpeRatio: number;
    maxDrawdown: number;
    maxDrawdownPeriod?: { start: string; end: string };
    rebalanceDates?: any[]; // Rebalancing events with all details
    dividendCash?: number;
    dividendCashIfReinvested?: number;
    shadowPortfolioValue?: number;
    shadowTotalReturn?: number;
    currentRiskContributions?: Record<string, number>;
  };

  // ...existing fields...
  currentHoldings?: { symbol: string; shares: number; buyPrice: number; note?: string }[];

};

const KEY = (uid: string) => `portfolios:${uid}`;

// --- Low level storage ---
function readAll(userId: string): Portfolio[] {
  try {
    const raw = localStorage.getItem(KEY(userId));
    return raw ? (JSON.parse(raw) as Portfolio[]) : [];
  } catch {
    return [];
  }
}

function writeAll(userId: string, items: Portfolio[]) {
  localStorage.setItem(KEY(userId), JSON.stringify(items));
}

// --- Public API you can import in pages ---

export function listPortfolios(userId: string): Portfolio[] {
  return readAll(userId);
}

export function getPortfolio(userId: string, id: string): Portfolio | undefined {
  return readAll(userId).find(p => p.id === id);
}

export function createPortfolio(
  userId: string,
  init: Partial<Portfolio> & { name?: string; approximateValue?: number }
): Portfolio {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p: Portfolio = {
    id,
    userId,
    name: init.name ?? "Untitled portfolio",
    createdAt: Date.now(),
    // copy questionnaire fields if provided
    riskTolerance: init.riskTolerance,
    timeHorizon: init.timeHorizon,
    approximateValue: init.approximateValue,
    currency: init.currency,
    exchanges: init.exchanges,
    focus: init.focus,
    rebalancing: init.rebalancing,
    targetHoldings: init.targetHoldings,
    // no results yet
    proposalSummary: undefined,
    proposalHoldings: undefined,
  };
  const all = readAll(userId);
  all.unshift(p);
  writeAll(userId, all);
  return p;
}

export function updatePortfolio(
  userId: string,
  id: string,
  patch: Partial<Portfolio>
): Portfolio | undefined {
  const all = readAll(userId);
  const i = all.findIndex(p => p.id === id);
  if (i === -1) return undefined;
  const updated = { ...all[i], ...patch, id: all[i].id, userId: all[i].userId };
  all[i] = updated;
  writeAll(userId, all);
  return updated;
}

export function deletePortfolio(userId: string, id: string) {
  const all = readAll(userId).filter(p => p.id !== id);
  writeAll(userId, all);
}

export function removePortfolio(userId: string, id: string) {
  const key = `portfolios:${userId}`;
  const list: Portfolio[] = JSON.parse(localStorage.getItem(key) || "[]");
  const next = list.filter(p => p.id !== id);
  localStorage.setItem(key, JSON.stringify(next));
  return true;
}
export function movePortfolio(fromUserId: string, toUserId: string, id: string) {
  const fromKey = `portfolios:${fromUserId}`;
  const toKey = `portfolios:${toUserId}`;

  const fromList: Portfolio[] = JSON.parse(localStorage.getItem(fromKey) || "[]");
  const toList: Portfolio[] = JSON.parse(localStorage.getItem(toKey) || "[]");

  const idx = fromList.findIndex(p => p.id === id);
  if (idx < 0) return false;

  const [p] = fromList.splice(idx, 1);
  localStorage.setItem(fromKey, JSON.stringify(fromList));
  localStorage.setItem(toKey, JSON.stringify([p, ...toList]));
  return true;
}
