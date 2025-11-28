"use client";

import { useState } from "react";
import { CHART_COLORS } from "@/components/ui/portfolio-components";

interface AllocationPieChartProps {
  weights: Array<{ ticker: string; weight: string; name: string }>;
}

export function AllocationPieChart({ weights }: AllocationPieChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = 360;
  
  let currentAngle = 0;
  const segments = weights.map((w, i) => {
    const percentage = parseFloat(w.weight);
    const angle = (percentage / 100) * total;
    const segment = {
      ...w,
      percentage,
      startAngle: currentAngle,
      endAngle: currentAngle + angle,
      color: CHART_COLORS[i % CHART_COLORS.length],
    };
    currentAngle += angle;
    return segment;
  });

  const radius = 80;
  const centerX = 100;
  const centerY = 100;

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="200" height="200" viewBox="0 0 200 200" className="mb-4">
          {segments.map((segment, i) => {
            const startAngle = (segment.startAngle - 90) * (Math.PI / 180);
            const endAngle = (segment.endAngle - 90) * (Math.PI / 180);
            
            const x1 = centerX + radius * Math.cos(startAngle);
            const y1 = centerY + radius * Math.sin(startAngle);
            const x2 = centerX + radius * Math.cos(endAngle);
            const y2 = centerY + radius * Math.sin(endAngle);
            
            const largeArc = segment.endAngle - segment.startAngle > 180 ? 1 : 0;
            
            const pathData = [
              `M ${centerX} ${centerY}`,
              `L ${x1} ${y1}`,
              `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
              'Z'
            ].join(' ');
            
            return (
              <path
                key={i}
                d={pathData}
                fill={segment.color}
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1"
                className="transition-all cursor-pointer"
                style={{
                  opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.4,
                  transform: hoveredIndex === i ? 'scale(1.05)' : 'scale(1)',
                  transformOrigin: '100px 100px',
                }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>
        
        {hoveredIndex !== null && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
            <div className="text-xs font-semibold">{segments[hoveredIndex].ticker}</div>
            <div className="text-lg font-bold">{segments[hoveredIndex].percentage.toFixed(1)}%</div>
          </div>
        )}
      </div>
      
      <div className="w-full space-y-2">
        {weights.map((w, i) => (
          <div 
            key={i} 
            className="flex items-center justify-between text-sm transition-opacity cursor-pointer"
            style={{ opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.5 }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              <span className="font-medium">{w.ticker}</span>
            </div>
            <span className="text-white/80">{w.weight}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
