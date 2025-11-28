// app/page.tsx
"use client";
import RotatingHeadline from "@/components/RotatingHeadline";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#0b1324] via-[#101d32] to-[#0b1324] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-14 px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm font-semibold uppercase tracking-[0.4em] text-white/60">
            AI Portfolio Creator
          </div>
          <nav className="flex items-center gap-4 text-sm font-semibold text-white/70">
            <a href="#features" className="hidden sm:inline hover:text-white">
              Features
            </a>
            <a href="#how-it-works" className="hidden sm:inline hover:text-white">
              How it works
            </a>

            <SignedOut>
              <SignInButton mode="modal">
                <button className="rounded-xl border border-white/40 bg-white/5 px-4 py-2 font-semibold text-white transition hover:bg-white/15">
                  Sign in
                </button>
              </SignInButton>
            </SignedOut>

            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </nav>
        </header>

        <section className="flex flex-col items-center gap-10">
          <div className="w-full max-w-3xl space-y-6 text-center">
            <RotatingHeadline
              items={[
                "Equal Risk Contribution portfolios in minutes",
                "Expected Shortfall optimization with full transparency",
                "Risk budgeting models tuned for discretionary PMs",
              ]}
            />
            <p className="text-lg text-white/80">
              Pick the macro posture, constraints, and risk appetite. Our ERC and Expected Shortfall engines assemble
              holdings, calculate performance, and document every decision with the same blue card design used across the
              platform.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="#how-it-works"
                className="rounded-2xl border border-white/20 bg-[#111f33] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#14243b]"
              >
                How it works
              </a>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600">
                    Start building
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <a
                  href="/dashboard"
                  className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600"
                >
                  Go to dashboard
                </a>
              </SignedIn>
            </div>

            {/* Stats removed per request */}
          </div>
        </section>

        <section id="features" className="space-y-8">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">Model library</p>
            <h2 className="mt-2 text-3xl font-bold">ERC & Expected Shortfall, presented clearly</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { title: "Equal Risk Contribution", copy: "Balance marginal contributions so each sleeve owns its share of volatility." },
              { title: "Expected Shortfall", copy: "Target worst-case loss percentiles to keep downside within mandate." },
              { title: "Diagnostics & PDFs", copy: "Explain the math with annotated cards, performance charts, and exports." },
            ].map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-[#16263c] bg-[#14243b] p-6 shadow-lg shadow-black/30">
                <p className="text-sm uppercase tracking-[0.2em] text-white/60">Model</p>
                <h3 className="mt-2 text-xl font-semibold">{feature.title}</h3>
                <p className="mt-3 text-sm text-white/75">{feature.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="rounded-3xl border border-[#16263c] bg-[#111f33] p-8 shadow-lg shadow-black/40">
          <div className="text-center">
            <h2 className="text-3xl font-bold">How the ERC & ES flow works</h2>
            <p className="mt-2 text-sm text-white/70">Same three-panel rhythm as your other multi-step screens.</p>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              { step: "1", title: "Frame objectives", body: "Supply risk budget, constraints, and lookback—UI matches portfolio setup." },
              { step: "2", title: "Run ERC / ES", body: "Engines solve ERC and Expected Shortfall with visual feedback on cards." },
              { step: "3", title: "Share results", body: "Review diagnostics, export PDFs, and send allocations to execution." },
            ].map((step) => (
              <div key={step.step} className="rounded-2xl border border-[#1e3353] bg-[#15253d] px-5 py-6">
                <p className="text-sm font-semibold text-emerald-300">Step {step.step}</p>
                <h3 className="mt-2 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-white/75">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-[#1b314e] bg-[#122139] px-8 py-10 text-center shadow-xl shadow-black/40">
          <h2 className="text-3xl font-bold">Ready to run ERC or Expected Shortfall?</h2>
          <p className="mt-3 text-white/70">
            Sign in, answer the same questionnaire, and you will land on the ERC/ES dashboards with familiar green buttons
            and navy cards.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="rounded-2xl bg-emerald-500 px-6 py-3 text-lg font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600">
                  Create my first portfolio
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <a
                href="/dashboard"
                className="rounded-2xl bg-emerald-500 px-6 py-3 text-lg font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-600"
              >
                Go to dashboard
              </a>
            </SignedIn>
            <a
              href="#features"
              className="rounded-2xl border border-white/15 px-6 py-3 text-lg font-semibold text-white/80 transition hover:bg-white/5"
            >
              Preview the UI
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
