// app/portfolio/setup/page.tsx
"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { useUser } from "@clerk/nextjs";
import { getPortfolio } from "@/lib/portfolioStore";

export default function PortfolioSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900" />}>
      <PortfolioSetupPageContent />
    </Suspense>
  );
}

function PortfolioSetupPageContent() {
  const pid = useSearchParams().get("pid");
  const router = useRouter();
  const { user } = useUser();
  const userId = user?.id ?? "";

  // Get portfolio name
  const portfolio = userId && pid ? getPortfolio(userId, pid) : null;
  const portfolioName = portfolio?.name || "your portfolio";

  if (!pid) {
    if (typeof window !== "undefined") router.replace("/dashboard");
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-4xl font-bold text-white drop-shadow-lg mb-3">
          Portfolio Analysis Options
        </h1>
        <p className="text-lg text-slate-200 font-medium mb-8">
          Choose your preferred analysis method for portfolio: {portfolioName}
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Option 1: Quick Portfolio */}
          <div className="rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl hover:border-slate-500/60 hover:bg-slate-800/70 transition-all flex flex-col">
            <div className="mb-4">
              <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold mb-3">
                RECOMMENDED
              </span>
              <h2 className="text-xl font-bold text-white mb-2">
                Quick Portfolio Builder
              </h2>
              <p className="text-sm text-slate-200 mb-4">
                Fast and simple portfolio creation using AI-powered
                recommendations
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span>AI-powered asset selection</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span>Instant portfolio generation</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span>Perfect for beginners</span>
                </li>
              </ul>
            </div>
            <Link
              href={`/portfolio/quick-build?pid=${pid}`}
              className="mt-auto inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-4 py-2.5 text-sm font-semibold shadow-lg hover:from-emerald-600 hover:to-emerald-700 transition-all"
            >
              Start Quick Build
            </Link>
          </div>

          {/* Option 2: Advanced Portfolio */}
          <div className="rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl hover:border-slate-500/60 hover:bg-slate-800/70 transition-all flex flex-col">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-white mb-2">
                Manual Portfolio Builder
              </h2>
              <p className="text-sm text-slate-200 mb-4">
                Full control over your portfolio composition and weights
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <span className="text-blue-400">✓</span>
                  <span>Custom asset selection</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-blue-400">✓</span>
                  <span>Manual weight allocation</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-blue-400">✓</span>
                  <span>For experienced investors</span>
                </li>
              </ul>
            </div>
            <Link
              href={`/portfolio/advanced?pid=${pid}`}
              className="mt-auto inline-flex items-center justify-center rounded-xl bg-slate-700/50 border border-slate-600/50 text-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-600/60 transition-all"
            >
              Start Manual Build
            </Link>
          </div>

          {/* Option 3: Full Analysis */}
          <div className="rounded-2xl border border-slate-600/50 bg-slate-800/60 p-6 backdrop-blur-xl shadow-2xl hover:border-slate-500/60 hover:bg-slate-800/70 transition-all flex flex-col">
            <div className="mb-4">
              <span className="inline-block px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-semibold mb-3">
                PROFESSIONAL
              </span>
              <h2 className="text-xl font-bold text-white mb-2">
                Risk Budgeting Portfolio
              </h2>
              <p className="text-sm text-slate-200 mb-4">
                Institutional-grade multi-asset allocation using quantitative
                risk management
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span>
                  <span>Equal Risk Contribution (ERC) optimization</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span>
                  <span>Custom risk budget allocation</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span>
                  <span>Historical backtesting & analytics</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span>
                  <span>Volatility targeting & leverage control</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400">✓</span>
                  <span>Correlation matrix & stress testing</span>
                </li>
              </ul>
            </div>
            <Link
              href={`/portfolio/full-analysis-option3?pid=${pid}`}
              className="mt-auto inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white px-4 py-2.5 text-sm font-semibold shadow-lg hover:from-purple-600 hover:to-purple-700 transition-all"
            >
              Start Risk Budgeting
            </Link>
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl border border-slate-600/50 bg-slate-700/50 px-5 py-3 font-semibold backdrop-blur transition hover:bg-slate-600/60"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
