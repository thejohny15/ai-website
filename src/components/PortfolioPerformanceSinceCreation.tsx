"use client";

import { useState, useEffect } from "react";

interface PortfolioPerformanceSinceCreationProps {
  holdings: Array<{ symbol: string; weight: number }>;
  createdAt: string;
  rebalancingDates?: string[]; // Array of rebalancing dates
  rebalancingFrequency?: string; // e.g., "monthly", "quarterly", "annually"
  benchmarkSymbol?: string;
}

export default function PortfolioPerformanceSinceCreation({ 
  holdings, 
  createdAt,
  rebalancingDates = [],
  rebalancingFrequency = "quarterly",
  benchmarkSymbol = "SPY"
}: PortfolioPerformanceSinceCreationProps) {
  const BASE_VALUE = 10000;
  const [chartData, setChartData] = useState<{ dates: string[], values: number[], benchmarkValues?: number[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"absolute" | "relative">("absolute");

  useEffect(() => {
    async function fetchPerformanceData() {
      setLoading(true);
      try {
        const endDate = new Date();
        const startDate = new Date(createdAt);

        const symbols = Array.from(new Set([...holdings.map(h => h.symbol), benchmarkSymbol]));
        const response = await fetch('/api/historical-quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbols,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0]
          })
        });

        if (!response.ok) {
          throw new Error('Failed to fetch historical data');
        }

        const data = await response.json();
        const historicalPrices = data.historicalPrices;

        const allDates = new Set<string>();
        Object.values(historicalPrices).forEach((priceData: any) => {
          priceData.forEach((item: any) => allDates.add(item.date));
        });
        
        const dates = Array.from(allDates).sort();
        
        const values = dates.map(date => {
          let portfolioValue = 0;
          holdings.forEach(holding => {
            const symbolData = historicalPrices[holding.symbol] || [];
            const priceItem = symbolData.find((item: any) => item.date === date);
            if (priceItem && priceItem.price) {
              portfolioValue += priceItem.price * (holding.weight / 100);
            }
          });
          return portfolioValue;
        });

        const firstValue = values.find(v => v > 0) || 1;
        const normalizedValues = values.map(v => (v / firstValue) * BASE_VALUE);

        const benchmarkValues = buildBenchmarkSeries(historicalPrices[benchmarkSymbol], dates);

        setChartData({ dates, values: normalizedValues, benchmarkValues });
        setLastUpdate(new Date());
      } catch (error) {
        console.error('Error fetching performance data:', error);
        setChartData(null);
      } finally {
        setLoading(false);
      }
    }

    fetchPerformanceData();

    return () => {};
  }, [holdings, createdAt]);

  if (loading && !chartData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-purple-500"></div>
      </div>
    );
  }

  if (!chartData || chartData.values.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-300">
        <p>Unable to load performance data</p>
      </div>
    );
  }

  const { dates, values, benchmarkValues } = chartData;
  const displayValues =
    viewMode === "absolute"
      ? values
      : values.map((v) => ((v - BASE_VALUE) / BASE_VALUE) * 100);
  const displayBenchmark =
    benchmarkValues && viewMode === "relative"
      ? benchmarkValues.map((v) => ((v - BASE_VALUE) / BASE_VALUE) * 100)
      : benchmarkValues;
  
  // Filter out invalid values before calculating min/max
  const validValues = displayValues.filter(v => Number.isFinite(v));
  const benchmarkValid = displayBenchmark
    ? displayBenchmark.filter((v) => Number.isFinite(v))
    : [];
  const combinedValid =
    benchmarkValid.length > 0 ? [...validValues, ...benchmarkValid] : validValues;

  if (validValues.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-300">
        <p>No valid data available</p>
      </div>
    );
  }
  
  const baseMin = Math.min(...validValues);
  const baseMax = Math.max(...validValues);
  const combinedMin = Math.min(...combinedValid);
  const combinedMax = Math.max(...combinedValid);
  const baseRange = Math.max(baseMax - baseMin, 1);
  const combinedRange = Math.max(combinedMax - combinedMin, baseRange);
  const paddingFactor = benchmarkValid.length > 0 ? 0.2 : 0.12;
  const padding = combinedRange * paddingFactor;
  const minValue = Math.min(baseMin, combinedMin) - padding;
  const maxValue = Math.max(baseMax, combinedMax) + padding;
  const range = maxValue - minValue;

  const height = 360;
  const width = 1000;

  const sampleRate = Math.max(1, Math.ceil(values.length / 200));
  const sampledValues = displayValues.filter((_: number, i: number) => i % sampleRate === 0);
  const sampledDates = dates.filter((_: string, i: number) => i % sampleRate === 0);

  const points = sampledValues.map((value: number, i: number) => {
    const x = (i / (sampledValues.length - 1)) * width;
    const y = height - ((value - minValue + padding) / (range + 2 * padding)) * height;
    return { x, y, value, date: sampledDates[i] };
  }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  const sampledBenchmarkValues = displayBenchmark?.filter((_: number, i: number) => i % sampleRate === 0) || [];
  const benchmarkPoints = sampledBenchmarkValues.map((value: number, i: number) => {
    const denom = Math.max(sampledBenchmarkValues.length - 1, 1);
    const x = (i / denom) * width;
    const clamped = Math.min(Math.max(value, minValue), maxValue);
    const y = height - ((clamped - minValue) / range) * height;
    return { x, y, value, date: sampledDates[i] };
  }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-300">
        <p>Unable to render chart data</p>
      </div>
    );
  }

  const pathData = points.map((p: any, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const totalReturn = ((values[values.length - 1] - 10000) / 10000) * 100;
  const daysSinceCreation = Math.floor((new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));

  // Calculate rebalancing positions
  const rebalancingPositions = rebalancingDates
    .map(dateStr => {
      const rebalanceDate = new Date(dateStr).toISOString().split('T')[0];
      const index = dates.findIndex(d => d >= rebalanceDate);
      if (index >= 0) {
        return {
          x: (index / (dates.length - 1)) * width,
          date: rebalanceDate
        };
      }
      return null;
    })
    .filter((pos): pos is { x: number; date: string } => pos !== null && pos.x >= 0 && pos.x <= width);

  // Calculate next rebalancing date
  const calculateNextRebalancing = () => {
    const lastRebalance = rebalancingDates.length > 0 
      ? new Date(rebalancingDates[rebalancingDates.length - 1])
      : new Date(createdAt);
    
    const nextDate = new Date(lastRebalance);
    switch(rebalancingFrequency) {
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'annually':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }
    return nextDate;
  };

  const nextRebalancingDate = calculateNextRebalancing();
  const daysUntilRebalance = Math.ceil((nextRebalancingDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="relative">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-slate-400">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </span>
        <div className="flex items-center gap-3 text-[11px] text-slate-300 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-purple-400"></span>
            Portfolio
          </div>
          {benchmarkValues && (
            <div className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-slate-200"></span>
              {benchmarkSymbol}
            </div>
          )}
          {rebalancingPositions.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="inline-block w-2 h-4 border-l-2 border-dashed border-[#f59e0b]"></span>
              Rebalance markers
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-[#a855f7] opacity-70"></span>
            Creation date
          </div>
        </div>
      </div>
      
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-hidden">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1={0} y1={height * ratio} x2={width} y2={height * ratio} stroke="rgba(148, 163, 184, 0.1)" strokeWidth="1" />
        ))}
        
        <path d={`${pathData} L ${width} ${height} L 0 ${height} Z`} fill="url(#gradient-perf-creation)" opacity="0.3" />
        <path d={pathData} fill="none" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {benchmarkPoints.length > 0 && (
          <path
            d={benchmarkPoints.map((p: any, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
            fill="none"
            stroke="rgba(226,232,240,0.85)"
            strokeWidth="2"
            strokeDasharray="6,4"
          />
        )}
        
        {/* Rebalancing lines */}
        {rebalancingPositions.map((pos, idx) => (
          <line 
            key={`rebalance-${idx}`}
            x1={pos.x} 
            y1={0} 
            x2={pos.x} 
            y2={height} 
            stroke="#f59e0b" 
            strokeWidth="2" 
            strokeDasharray="4,4" 
            opacity="0.7"
          />
        ))}
        
        <defs>
          <linearGradient id="gradient-perf-creation" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Hover point */}
        {hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < points.length && (
          <circle cx={points[hoveredIndex]!.x} cy={points[hoveredIndex]!.y} r="5" fill="#a855f7" stroke="white" strokeWidth="2" />
        )}
        {hoveredIndex !== null && benchmarkPoints.length > hoveredIndex && (
          <circle cx={benchmarkPoints[hoveredIndex]!.x} cy={benchmarkPoints[hoveredIndex]!.y} r="4" fill="rgba(226,232,240,0.9)" stroke="white" strokeWidth="1" />
        )}
      </svg>

      {hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < points.length && (
        <div className="absolute bg-slate-900/95 text-white px-4 py-2 rounded-lg text-sm pointer-events-none border border-slate-600 shadow-xl z-10"
          style={{ left: `${(points[hoveredIndex]!.x / width) * 100}%`, top: `${(points[hoveredIndex]!.y / height) * 100}%`, transform: 'translate(-50%, -120%)' }}>
          <div className="text-xs text-slate-400 mb-1">{points[hoveredIndex]!.date}</div>
          <div className="text-xs text-slate-200">
            Portfolio:{" "}
            <span className="font-semibold text-white">
              {viewMode === "absolute"
                ? `$${points[hoveredIndex]!.value.toFixed(2)}`
                : `${points[hoveredIndex]!.value >= 0 ? "+" : ""}${points[hoveredIndex]!.value.toFixed(2)}%`}
            </span>
          </div>
          {benchmarkPoints.length > hoveredIndex && (
            <div className="text-xs text-slate-300 mt-1">
              {benchmarkSymbol}:{" "}
              <span className="font-semibold">
                {viewMode === "absolute"
                  ? `$${benchmarkPoints[hoveredIndex]!.value.toFixed(2)}`
                  : `${benchmarkPoints[hoveredIndex]!.value >= 0 ? "+" : ""}${benchmarkPoints[hoveredIndex]!.value.toFixed(2)}%`}
              </span>
            </div>
          )}
        </div>
      )}

      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="absolute top-0 left-0"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          const closestIndex = Math.round((x / width) * (points.length - 1));
          setHoveredIndex(Math.max(0, Math.min(points.length - 1, closestIndex)));
        }}
        onMouseLeave={() => setHoveredIndex(null)}>
        <rect width={width} height={height} fill="transparent" />
      </svg>

      <div className="mt-2 flex justify-center text-xs text-slate-300">
        {viewMode === "absolute"
          ? "Portfolio Value Since Creation (Starting: $10,000)"
          : "Return Since Creation"}
      </div>
      <div className="flex justify-end gap-2 text-[11px] text-slate-300 mt-2">
        <button
          onClick={() => setViewMode("absolute")}
          className={`px-2 py-0.5 rounded border ${
            viewMode === "absolute" ? "border-purple-400 text-white" : "border-slate-600 text-slate-300"
          }`}
        >
          $
        </button>
        <button
          onClick={() => setViewMode("relative")}
          className={`px-2 py-0.5 rounded border ${
            viewMode === "relative" ? "border-purple-400 text-white" : "border-slate-600 text-slate-300"
          }`}
        >
          %
        </button>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-xs text-slate-400">Total Return</div>
          <div className={`text-lg font-bold ${totalReturn >= 0 ? 'text-purple-400' : 'text-red-400'}`}>
            {totalReturn.toFixed(2)}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-400">Current Value</div>
          <div className="text-lg font-bold text-white">${values[values.length - 1].toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-400">Days Active</div>
          <div className="text-lg font-bold text-white">{daysSinceCreation}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-400">Next Rebalance</div>
          <div className="text-lg font-bold text-amber-400">
            {daysUntilRebalance > 0 ? `${daysUntilRebalance}d` : 'Due'}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {nextRebalancingDate.toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildBenchmarkSeries(
  priceSeries: { date: string; price: number }[] | undefined,
  targetDates: string[]
): number[] | undefined {
  if (!priceSeries || priceSeries.length === 0) return undefined;
  const priceMap = new Map(priceSeries.map((pt) => [pt.date, pt.price]));
  let lastPrice = priceSeries[0].price || 1;
  const startPrice = priceSeries[0].price || 1;

  return targetDates.map((date) => {
    if (priceMap.has(date)) {
      lastPrice = priceMap.get(date)!;
    }
    return (lastPrice / startPrice) * 10000;
  });
}
