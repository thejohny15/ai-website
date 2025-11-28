// app/portfolio/path/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  getPortfolio,
  updatePortfolio,
  movePortfolio,
  type Holding,
  type Portfolio,
} from "@/lib/portfolioStore";

type CurrentSnapshot = {
  asOf: string;
  inflationYoY?: number;
  unemploymentRate?: number;
  policyRate?: number;
  gdpGrowthYoY?: number;
  marketValuationNote?: string;
  risks?: string[];
};

export type Scenario = {
  id: string;
  name: string;
  probability?: number;
  narrative: string;
  assumptions: {
    inflationYoY?: number;
    unemploymentRate?: number;
    policyRate?: number;
    gdpGrowthYoY?: number;
    other?: string[];
  };
  portfolioGuidance?: string;
};

export default function PathPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-start)]" />}>
      <PathPageContent />
    </Suspense>
  );
}

function PathPageContent() {
  const pid = useSearchParams().get("pid");
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CurrentSnapshot | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const [picked, setPicked] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [proposal, setProposal] = useState<{ summary: any; holdings: Holding[] } | null>(null);

  // Step 1: fetch snapshot + scenarios once we have pid + userId
useEffect(() => {
  if (!pid || !isLoaded || !userId) return;

  let cancelled = false;

  // Try to find the portfolio for this user. If not found, try to "claim" it
  // from common guest buckets where it might have been created before Clerk loaded.
  const ensurePortfolio = () => {
    let p = getPortfolio(userId, pid);
    if (p) return p;

    const candidates = ["", "local-user", "guest"];
    for (const from of candidates) {
      if (from === userId) continue;
      try {
        const moved = movePortfolio(from, userId, pid);
        if (moved) {
          p = getPortfolio(userId, pid);
          if (p) return p;
        }
      } catch {
        /* ignore */
      }
    }
    return undefined;
  };

  const p = ensurePortfolio();
  if (!p) {
    // still nothing—bounce back
    router.replace("/dashboard");
    return;
  }

  (async () => {
    try {
      setLoading(true);
      setError(null);
      setProposal(null);

      // Ensure portfolio has required fields for API
      const portfolioForAPI = {
        ...p,
        approximateValue: p.approximateValue || 10000 // Default value if missing
      };
      
      const res = await fetch("/api/path/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio: portfolioForAPI }), // <-- use the ensured portfolio
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      if (!cancelled) {
        setSnapshot(data.current_snapshot);
        setScenarios(data.scenarios || []);
      }
    } catch (e: any) {
      if (!cancelled) setError(e.message || "Failed to fetch scenarios.");
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [pid, isLoaded, userId, router]);


  // Step 2: build portfolio for the picked scenario
  async function buildForPicked() {
    if (!pid || !userId || !picked) return;

    const portfolio = getPortfolio(userId, pid);
    if (!portfolio) { router.replace("/dashboard"); return; }

    try {
      setBuilding(true);
      setError(null);

      // Ensure API compatibility
      const portfolioForAPI = {
        ...portfolio,
        approximateValue: portfolio.approximateValue || 10000
      };

      const res = await fetch("/api/path/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio: portfolioForAPI, scenarioId: picked }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setProposal({ summary: data.summary, holdings: data.holdings });
    } catch (e: any) {
      setError(e.message || "Failed to build portfolio for scenario.");
    } finally {
      setBuilding(false);
    }
  }

  // Step 3: save to your store and go to detail
  function acceptDraft() {
    if (!pid || !userId || !proposal) return;
    updatePortfolio(userId, pid, {
      proposalSummary: proposal.summary,
      proposalHoldings: proposal.holdings,
    });
    router.push(`/dashboard/${pid}`); // go to the detail page
  }

  if (!pid) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-[var(--bg-start)] to-[var(--bg-end)] text-white p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-extrabold">Option 2 — Pick a macro path</h1>
        <p className="mt-2 text-white/90">
          AI summarizes the current economy, proposes three plausible paths. You choose one; it builds the portfolio for that path.
        </p>

        {loading ? (
          <p className="mt-8 text-white/80">Generating snapshot & scenarios…</p>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur">
            <p className="text-red-200">{error}</p>
          </div>
        ) : (
          <>
            {snapshot && (
              <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur">
                <h2 className="font-semibold">
                  Current snapshot (as of {new Date(snapshot.asOf).toLocaleDateString()})
                </h2>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {num(snapshot.inflationYoY) && (
                    <Stat label="Inflation (YoY)" value={`${snapshot.inflationYoY!.toFixed(1)}%`} />
                  )}
                  {num(snapshot.unemploymentRate) && (
                    <Stat label="Unemployment" value={`${snapshot.unemploymentRate!.toFixed(1)}%`} />
                  )}
                  {num(snapshot.policyRate) && (
                    <Stat label="Policy rate" value={`${snapshot.policyRate!.toFixed(2)}%`} />
                  )}
                  {num(snapshot.gdpGrowthYoY) && (
                    <Stat label="GDP growth (YoY)" value={`${snapshot.gdpGrowthYoY!.toFixed(1)}%`} />
                  )}
                </div>
                {snapshot.marketValuationNote && (
                  <p className="mt-3 text-white/80">{snapshot.marketValuationNote}</p>
                )}
                {snapshot.risks?.length ? (
                  <ul className="mt-3 list-disc pl-5 text-white/80">
                    {snapshot.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setPicked(s.id)}
                  className={`text-left rounded-2xl border p-5 backdrop-blur transition ${
                    picked === s.id
                      ? "border-white bg-white/20"
                      : "border-white/20 bg-white/10 hover:bg-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{s.name}</h3>
                    {num(s.probability) && (
                      <span className="text-xs rounded-full border border-white/30 px-2 py-0.5 text-white/80">
                        {(s.probability! * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-white/90">{s.narrative}</p>
                  {s.assumptions && (
                    <ul className="mt-2 text-xs text-white/80 space-y-1">
                      {num(s.assumptions.inflationYoY) && <li>Inflation ≈ {s.assumptions.inflationYoY}%</li>}
                      {num(s.assumptions.unemploymentRate) && <li>Unemployment ≈ {s.assumptions.unemploymentRate}%</li>}
                      {num(s.assumptions.policyRate) && <li>Policy rate ≈ {s.assumptions.policyRate}%</li>}
                      {num(s.assumptions.gdpGrowthYoY) && <li>GDP growth ≈ {s.assumptions.gdpGrowthYoY}%</li>}
                    </ul>
                  )}
                  {s.portfolioGuidance && (
                    <p className="mt-2 text-xs text-white/70 italic">{s.portfolioGuidance}</p>
                  )}
                </button>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={buildForPicked}
                disabled={!picked || building}
                className="rounded-xl border border-white/70 bg-white/10 px-5 py-3 font-semibold backdrop-blur hover:bg-white/20 disabled:opacity-50"
              >
                {building ? "Building…" : picked ? "Build this scenario" : "Pick a scenario"}
              </button>

              <Link
                href={`/portfolio/setup?pid=${pid}`}
                className="rounded-xl border border-white/70 bg-white/10 px-5 py-3 font-semibold backdrop-blur hover:bg-white/20"
              >
                Back to options
              </Link>
            </div>

            {proposal && (
              <div className="mt-8 space-y-6">
                <div className="rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur">
                  <h2 className="font-semibold">Why this portfolio?</h2>
                  <SummaryBlock summary={proposal.summary} />
                </div>

                <div className="rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur overflow-x-auto">
                  <table className="w-full text-left text-white/90">
                    <thead>
                      <tr className="text-white/80">
                        <th className="py-2">Symbol</th>
                        <th className="py-2">Weight</th>
                        <th className="py-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.holdings.map((h) => (
                        <tr key={h.symbol} className="border-t border-white/10">
                          <td className="py-2 font-semibold">{h.symbol}</td>
                          <td className="py-2">{h.weight.toFixed(2)}%</td>
                          <td className="py-2 text-white/80">{h.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={acceptDraft}
                    className="rounded-xl bg-white text-[var(--bg-end)] px-5 py-3 font-semibold hover:opacity-95"
                  >
                    Save to dashboard
                  </button>
                </div>

                <RefineBox pid={pid as string} proposal={proposal} onApply={(p) => setProposal(p)} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function num(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/20 bg-white/5 p-4">
      <div className="text-xs text-white/70">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function SummaryBlock({ summary }: { summary: any }) {
  if (!summary) return null;
  if (typeof summary === "string") return <p className="mt-2 text-white/90 leading-relaxed">{summary}</p>;

  const et = summary["Economic Thesis"];
  const shaped = summary["How Your Answers Shaped This"];
  const logic = summary["Portfolio Logic"];
  const tradeoffs = summary["Key Trade-offs"];

  return (
    <div className="mt-2 text-white/90 leading-relaxed space-y-4">
      {et && (
        <section>
          <h3 className="font-semibold">Economic Thesis</h3>
          <p>{et}</p>
        </section>
      )}
      {shaped && (
        <section>
          <h3 className="font-semibold">How Your Answers Shaped This</h3>
          {Array.isArray(shaped) ? (
            <ul className="list-disc pl-5">
              {shaped.map((x: any, i: number) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p>{shaped}</p>
          )}
        </section>
      )}
      {logic && (
        <section>
          <h3 className="font-semibold">Portfolio Logic</h3>
          <p>{logic}</p>
        </section>
      )}
      {tradeoffs && (
        <section>
          <h3 className="font-semibold">Key Trade-offs</h3>
          {Array.isArray(tradeoffs) ? (
            <ul className="list-disc pl-5">
              {tradeoffs.map((x: any, i: number) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p>{tradeoffs}</p>
          )}
        </section>
      )}
    </div>
  );
}

// === Refine with AI Component ===
function RefineBox({
  pid,
  proposal,
  onApply,
}: {
  pid: string;
  proposal: { summary: any; holdings: Holding[] } | null;
  onApply: (p: { summary: any; holdings: Holding[] }) => void;
}) {
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? "";
  const [open, setOpen] = useState(true);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<Array<{ symbol: string; from: number; to: number; delta: number; action: string }>>([]);

  async function submit() {
    if (!proposal || !msg.trim() || !isLoaded || !userId) return;
    try {
      setLoading(true);
      setError(null);
      const portfolio = getPortfolio(userId, pid);
      if (!portfolio) throw new Error("Portfolio not found");

      const res = await fetch("/api/path/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio,
          currentHoldings: proposal.holdings,
          instruction: msg.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      onApply({ summary: data.summary, holdings: data.holdings });
      setTrades(data.trades || []);
      setMsg("");
      setOpen(true);
    } catch (e: any) {
      setError(e.message || "Failed to refine");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Refine with AI</h3>
        <button onClick={() => setOpen(!open)} className="text-sm underline opacity-80">
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-white/80 text-sm">
            Describe a change. Examples: “Exclude Energy sector”, “Cap any single stock at 8%”, “Increase defensive tilt with healthcare ETFs”, “Reduce China exposure”.
          </p>
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="e.g., Exclude Energy and replace with diversified Industrials & Utilities exposure without raising overall beta"
            className="w-full rounded-xl bg-white/5 p-3 outline-none"
            rows={3}
          />
          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={loading || !msg.trim()}
              className="rounded-xl border border-white/70 bg-white/10 px-4 py-2 font-semibold hover:bg-white/20 disabled:opacity-50"
            >
              {loading ? "Rebalancing…" : "Apply change"}
            </button>
          </div>

          {error && <p className="text-red-200 text-sm">{error}</p>}

          {trades.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-white/90 text-sm">
                <thead>
                  <tr className="text-white/70">
                    <th className="py-1">Action</th>
                    <th className="py-1">Symbol</th>
                    <th className="py-1">From</th>
                    <th className="py-1">To</th>
                    <th className="py-1">Δ (pp)</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={i} className="border-t border-white/10">
                      <td className="py-1 capitalize">{t.action}</td>
                      <td className="py-1 font-semibold">{t.symbol}</td>
                      <td className="py-1">{t.from}%</td>
                      <td className="py-1">{t.to}%</td>
                      <td className="py-1">{t.delta > 0 ? "+" : ""}{t.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
