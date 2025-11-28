import { CHART_COLORS } from "@/components/ui/portfolio-components";

interface RiskContributionChartProps {
  weights: Array<{ ticker: string; riskContribution: string; name: string }>;
}

export function RiskContributionChart({ weights }: RiskContributionChartProps) {
  const maxRC = Math.max(...weights.map((w) => parseFloat(w.riskContribution)));

  return (
    <div className="space-y-3">
      {weights.map((w, i) => {
        const rc = parseFloat(w.riskContribution);
        const barWidth = (rc / maxRC) * 100;
        
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{w.ticker}</span>
              <span className="text-white/80">{w.riskContribution}%</span>
            </div>
            <div className="h-6 w-full rounded-lg bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-lg transition-all duration-500 flex items-center justify-end pr-2"
                style={{ 
                  width: `${barWidth}%`,
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length]
                }}
              >
                {barWidth > 20 && (
                  <span className="text-xs font-semibold text-white">
                    {w.name}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      
      <div className="mt-4 pt-4 border-t border-white/20">
        <p className="text-xs text-white/70 text-center">
          Each bar represents the asset's contribution to total portfolio risk.
          {(() => {
            const rcs = weights.map((w) => parseFloat(w.riskContribution));
            const maxDiff = Math.max(...rcs) - Math.min(...rcs);
            return maxDiff < 1 
              ? " Equal heights = Equal Risk Contribution ✓"
              : " Custom risk budgets achieved ✓";
          })()}
        </p>
      </div>
    </div>
  );
}
