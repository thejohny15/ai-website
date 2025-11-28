import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Quote = {
  symbol: string;
  price: number | null; // Latest daily close
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  currency: string | null;
  name?: string | null;
  source: string;
  time?: string | null;
};

type Body = { symbols: string[] };

export async function POST(req: Request) {
  try {
    const { symbols } = (await req.json()) as Body;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: "symbols required" }, { status: 400 });
    }

    const uniq = Array.from(new Set(symbols.map((s) => String(s).trim().toUpperCase()))).slice(0, 50);
    const out: Record<string, Quote> = {};

    // Use Yahoo Finance API (free, no API key needed)
    for (const symbol of uniq) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`;
        const res = await fetch(url, { 
          next: { revalidate: 3600 },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        });
        
        if (res.ok) {
          const data = await res.json();
          const result = data.chart?.result?.[0];
          const meta = result?.meta;
          const quoteData = result?.indicators?.quote?.[0];
          const closes: (number | null)[] = quoteData?.close ?? [];
          const timestamps: number[] = result?.timestamp ?? [];
          
          if (closes.length > 0) {
            let lastIdx = closes.length - 1;
            while (lastIdx >= 0 && (closes[lastIdx] === null || !Number.isFinite(closes[lastIdx]!))) {
              lastIdx--;
            }
            if (lastIdx < 0) continue;
            
            const lastClose = closes[lastIdx];
            let prevIdx = lastIdx - 1;
            while (prevIdx >= 0 && (closes[prevIdx] === null || !Number.isFinite(closes[prevIdx]!))) {
              prevIdx--;
            }
            const prevClose = prevIdx >= 0 ? closes[prevIdx] : null;
            
            const change = (lastClose !== null && prevClose !== null) ? lastClose - prevClose : null;
            const changePercent = (change !== null && prevClose)
              ? (change / prevClose) * 100
              : null;
            
            const closeTimestamp = timestamps[lastIdx]
              ? new Date(timestamps[lastIdx] * 1000).toISOString()
              : new Date().toISOString();
            
            out[symbol] = {
              symbol,
              price: toNum(lastClose),
              change: toNum(change),
              changePercent: toNum(changePercent),
              previousClose: toNum(prevClose),
              currency: meta?.currency || "USD",
              name: meta?.longName || meta?.shortName || null,
              source: "yahoo-close",
              time: closeTimestamp,
            };
          }
        } else {
          console.log(`Yahoo Finance error for ${symbol}: ${res.status}`);
        }
      } catch (e) {
        console.log(`Error fetching ${symbol}:`, e);
        continue;
      }
    }

    return NextResponse.json({ quotes: out, provider: "yahoo" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    provider: "yahoo",
    usage: "POST { symbols: string[] }  // uses Yahoo Finance (free, no API key needed)",
  });
}

/* helpers */
function toNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
