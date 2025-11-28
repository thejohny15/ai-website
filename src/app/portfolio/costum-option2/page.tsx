// app/portfolio/custom/page.tsx
"use client";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function CustomScenarioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-start)]" />}>
      <CustomScenarioPageContent />
    </Suspense>
  );
}

function CustomScenarioPageContent() {
  const pid = useSearchParams().get("pid");
  const router = useRouter();
  if (!pid) { if (typeof window !== "undefined") router.replace("/dashboard"); return null; }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[var(--bg-start)] to-[var(--bg-end)] text-white p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-extrabold">Your Scenario</h1>
        <p className="mt-2 text-white/90">
          (Next step) You’ll set your assumptions (inflation, rates, growth, sector views), and the AI will construct the best-matching portfolio.
        </p>
        <div className="mt-6">
          <Link href={`/dashboard`} className="rounded-xl bg-white text-[var(--bg-end)] px-5 py-3 font-semibold hover:opacity-95">Back to dashboard</Link>
        </div>
      </div>
    </main>
  );
}
