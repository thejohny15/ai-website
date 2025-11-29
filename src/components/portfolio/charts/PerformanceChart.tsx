"use client";

import { useState } from "react";

interface PerformanceChartProps {
  values: number[];
  dates: string[];
  benchmark?: { label: string; values: number[] };
}

export function PerformanceChart({ values, dates, benchmark }: PerformanceChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  const sampleRate = Math.ceil(values.length / 250);
  const sampledValues = values.filter((_, i) => i % sampleRate === 0);
  const sampledDates = dates.filter((_, i) => i % sampleRate === 0);
  const sampledBenchmark =
    benchmark?.values?.length
      ? benchmark.values.filter((_, i) => i % sampleRate === 0)
      : null;
  
  const minValue = Math.min(...values, ...(sampledBenchmark ?? values));
  const maxValue = Math.max(...values, ...(sampledBenchmark ?? values));
  const range = maxValue - minValue;
  const padding = range * 0.1;
  
  const height = 420;
  const width = 1200;
  const topMargin = 60;
  const bottomMargin = 40;
  const leftMargin = 90;
  const rightMargin = 20;
  const chartWidth = width - leftMargin - rightMargin;
  const chartHeight = height - topMargin - bottomMargin;
  
  const points = sampledValues.map((value, i) => {
    const x = leftMargin + (i / (sampledValues.length - 1)) * chartWidth;
    const normalizedValue = (value - minValue + padding) / (range + 2 * padding);
    const y = topMargin + chartHeight * (1 - normalizedValue);
    return { x, y, value, date: sampledDates[i] };
  });
  const benchmarkPoints =
    sampledBenchmark && sampledBenchmark.length === sampledDates.length
      ? sampledBenchmark.map((value, i) => {
          const x = leftMargin + (i / (sampledBenchmark.length - 1)) * chartWidth;
          const normalizedValue = (value - minValue + padding) / (range + 2 * padding);
          const y = topMargin + chartHeight * (1 - normalizedValue);
          return { x, y, value, date: sampledDates[i] };
        })
      : null;
  
  const maxPoint = points.reduce((max, p) => p.value > max.value ? p : max, points[0]);
  const minPoint = points.reduce((min, p) => p.value < min.value ? p : min, points[0]);
  
  const timeMarkers: { x: number; date: string }[] = [];
  const totalDays = dates.length;
  const sixMonthInterval = Math.floor(totalDays / 8);
  
  for (let i = 0; i < dates.length; i += sixMonthInterval) {
    const dateIndex = Math.min(i, dates.length - 1);
    const date = dates[dateIndex];
    const progress = i / (dates.length - 1);
    const x = leftMargin + progress * chartWidth;
    
    const formattedDate = new Date(date).toLocaleDateString('en-US', { 
      month: 'short', 
      year: 'numeric' 
    });
    
    timeMarkers.push({ x, date: formattedDate });
  }
  
  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const benchmarkPath =
    benchmarkPoints && benchmarkPoints.length > 1
      ? benchmarkPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      : null;
  
  return (
    <div className="relative">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={leftMargin}
            y1={topMargin + chartHeight * ratio}
            x2={width - rightMargin}
            y2={topMargin + chartHeight * ratio}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1"
          />
        ))}
        
        <text
          x={leftMargin - 15}
          y={maxPoint.y}
          textAnchor="end"
          fill="rgba(255,255,255,0.85)"
          fontSize="15"
          fontWeight="600"
          dominantBaseline="middle"
        >
          ${maxValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </text>
        <text
          x={leftMargin - 15}
          y={minPoint.y}
          textAnchor="end"
          fill="rgba(255,255,255,0.85)"
          fontSize="15"
          fontWeight="600"
          dominantBaseline="middle"
        >
          ${minValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </text>
        
        {timeMarkers.map((marker, i) => (
          <g key={i}>
            <line
              x1={marker.x}
              y1={topMargin + chartHeight}
              x2={marker.x}
              y2={topMargin + chartHeight + 5}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1"
            />
            <text
              x={marker.x}
              y={topMargin + chartHeight + 20}
              textAnchor="middle"
              fill="rgba(255,255,255,0.7)"
              fontSize="11"
            >
              {marker.date}
            </text>
          </g>
        ))}
        
        <path
          d={`${pathData} L ${width - rightMargin} ${topMargin + chartHeight} L ${leftMargin} ${topMargin + chartHeight} Z`}
          fill="url(#gradient)"
          opacity="0.3"
        />
        
        <path
          d={pathData}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="benchmarkGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
          </linearGradient>
        </defs>

        {benchmarkPath && benchmarkPoints && (
          <>
            <path
              d={`${benchmarkPath} L ${width - rightMargin} ${topMargin + chartHeight} L ${leftMargin} ${topMargin + chartHeight} Z`}
              fill="url(#benchmarkGradient)"
              opacity="0.25"
            />
            <path
              d={benchmarkPath}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="6 4"
            />
          </>
        )}
        
        {hoveredIndex !== null && points[hoveredIndex] && (
          <circle
            cx={points[hoveredIndex].x}
            cy={points[hoveredIndex].y}
            r="4"
            fill="#10b981"
            stroke="white"
            strokeWidth="2"
          />
        )}
        {hoveredIndex !== null && benchmarkPoints && benchmarkPoints[hoveredIndex] && (
          <circle
            cx={benchmarkPoints[hoveredIndex].x}
            cy={benchmarkPoints[hoveredIndex].y}
            r="4"
            fill="#60a5fa"
            stroke="white"
            strokeWidth="2"
          />
        )}
      </svg>
      
      {hoveredIndex !== null && points[hoveredIndex] && (
        <div
          className="absolute bg-black/80 text-white px-3 py-2 rounded-lg text-sm pointer-events-none"
          style={{
            left: `${(points[hoveredIndex].x / width) * 100}%`,
            top: `${(points[hoveredIndex].y / height) * 100}%`,
            transform: 'translate(-50%, -140%)',
          }}
        >
          <div className="font-semibold">Portfolio: ${points[hoveredIndex].value.toFixed(2)}</div>
          {benchmarkPoints && benchmarkPoints[hoveredIndex] && (
            <div className="font-semibold text-blue-200">
              {benchmark?.label || "Benchmark"}: ${benchmarkPoints[hoveredIndex].value.toFixed(2)}
            </div>
          )}
          <div className="text-xs text-white/70">{points[hoveredIndex].date}</div>
        </div>
      )}
      
      <div
        className="absolute inset-0"
        style={{ cursor: 'crosshair' }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const relativeX = (x / rect.width) * width;
          
          const chartX = relativeX - leftMargin;
          const normalizedX = Math.max(0, Math.min(1, chartX / chartWidth));
          const closestIndex = Math.round(normalizedX * (points.length - 1));
          
          setHoveredIndex(Math.max(0, Math.min(points.length - 1, closestIndex)));
        }}
        onMouseLeave={() => setHoveredIndex(null)}
      />
      
      <div className="mt-3 flex justify-center gap-4 text-sm text-white/80">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-emerald-400"></span>
          Portfolio
        </div>
        {benchmark && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-blue-400"></span>
            {benchmark.label || "Benchmark"}
          </div>
        )}
      </div>
    </div>
  );
}
