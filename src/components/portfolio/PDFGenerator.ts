"use client";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Optimizer = "erc" | "es";
type Lookback = "1y" | "3y" | "5y" | "3m";

interface PortfolioWeight {
  name: string;
  ticker: string;
  weight: number | string;
  riskContribution?: number | string;
}

interface PortfolioMetrics {
  expectedReturn?: number | string;
  portfolioVolatility?: number | string;
  sharpeRatio?: number | string;
  maxDrawdown?: number | string;
}

interface BacktestResults {
  totalReturn?: number | string;
  annualizedReturn?: number | string;
  annualizedVolatility?: number | string;
  sharpeRatio?: number | string;
  maxDrawdown?: number | string;
  finalValue?: number | string;
  rebalanceCount?: number;
  dividendCash?: number;
  dividendCashIfReinvested?: number;
  portfolioValues?: number[];
  dates?: string[];
  maxDrawdownPeriod?: {
    start?: string;
    end?: string;
  };
  benchmark?: { ticker: string; values: number[]; dates?: string[] };
  benchmarkMetrics?: {
    totalReturn: string;
    annualizedReturn: string;
    annualizedVolatility: string;
    sharpeRatio: string;
  };
}

interface ComparisonResults {
  return?: number | string;
  volatility?: number | string;
  sharpe?: number | string;
  maxDrawdown?: number | string;
}

interface PortfolioResults {
  asOf?: string;
  weights: PortfolioWeight[];
  correlationMatrix?: number[][];
  avgCorrelation?: number | string;
  metrics?: PortfolioMetrics;
  volatilityTargeting?: {
    leverage?: string;
    targetVol?: string;
    realizedVol?: string;
    scalingFactor?: string;
  };
  analytics?: {
    backtest?: BacktestResults;
    comparison?: {
      riskBudgeting?: ComparisonResults;
      equalWeight?: ComparisonResults;
    };
    stressTest?: {
      worstPeriod?: {
        start?: string;
        end?: string;
        loss?: number | string;
      };
    };
  };
  includeDividends?: boolean;
  livePerformance?: {
    totalReturnPct?: number | string;
    finalValue?: number | string;
    startDate?: string;
    endDate?: string;
  };
  currentPerformanceSeries?: { date?: string; value: number }[];
  performanceSinceCreationSeries?: { date?: string; portfolioValue: number; benchmarkValue?: number }[];
  performanceSinceCreationBenchmark?: string;
}

const LOOKBACK_LABELS: Record<Lookback, string> = {
  "3m": "Last 3 Months",
  "1y": "Last Year",
  "3y": "Last 3 Years",
  "5y": "Last 5 Years",
};

const OPTIMIZER_LABELS: Record<Optimizer, string> = {
  erc: "Equal Risk Contribution (ERC)",
  es: "Expected Shortfall (ES)",
};

const formatPercent = (value?: number | string | null): string => {
  if (value === undefined || value === null || value === "") return "—";
  const numeric = typeof value === "string" ? parseFloat(value.replace('%', '')) : value;
  if (Number.isNaN(numeric)) return "—";
  return `${numeric.toFixed(2)}%`;
};

const formatCurrency = (value?: number | string | null): string => {
  if (value === undefined || value === null || value === "") return "—";
  const str = value.toString().replace(/[$,]/g, '');
  const numeric = parseFloat(str);
  if (Number.isNaN(numeric)) return "—";
  return `$${numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatNumber = (value?: number | string | null): string => {
  if (value === undefined || value === null || value === "") return "—";
  const numeric = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(numeric)) return "—";
  return numeric.toFixed(2);
};

function drawValueLineChart(
  doc: jsPDF,
  opts: {
    values: number[];
    x: number;
    y: number;
    width: number;
    height: number;
    color: [number, number, number];
    dates?: string[];
    secondaryValues?: number[];
    secondaryColor?: [number, number, number];
    secondaryDash?: number[];
  }
): number {
  const {
    values,
    x,
    y,
    width,
    height,
    color,
    dates,
    secondaryValues,
    secondaryColor = [148, 163, 184],
    secondaryDash = [4, 3],
  } = opts;
  if (!values.length) return y;

  const minPrimary = Math.min(...values);
  const maxPrimary = Math.max(...values);
  let min = minPrimary;
  let max = maxPrimary;
  if (secondaryValues?.length) {
    min = Math.min(min, ...secondaryValues);
    max = Math.max(max, ...secondaryValues);
  }
  const range = Math.max(max - min, 1);
  // Add a bit more breathing room but keep labels aligned below the timeline
  const paddedRange = range * 1.15;
  const paddedMin = min - range * 0.08;
  const paddedMax = paddedMin + paddedRange;

  let minIndex = 0;
  let maxIndex = 0;
  doc.setLineWidth(1.5);
  doc.setDrawColor(...color);
  let prevX = x;
  let prevY = y + height - ((values[0] - paddedMin) / paddedRange) * height;
  for (let i = 1; i < values.length; i++) {
    const currX = x + (i / (values.length - 1)) * width;
    const currY = y + height - ((values[i] - paddedMin) / paddedRange) * height;
    doc.line(prevX, prevY, currX, currY);
    if (values[i] < values[minIndex]) minIndex = i;
    if (values[i] > values[maxIndex]) maxIndex = i;
    prevX = currX;
    prevY = currY;
  }

  if (secondaryValues && secondaryValues.length > 1) {
    const denom = Math.max(secondaryValues.length - 1, 1);
    doc.setLineWidth(1.25);
    doc.setDrawColor(...secondaryColor);
    doc.setLineDashPattern(secondaryDash, 0);
    let prevSX = x;
    let prevSY = y + height - ((secondaryValues[0] - paddedMin) / paddedRange) * height;
    for (let i = 1; i < secondaryValues.length; i++) {
      const currX = x + (i / denom) * width;
      const currY = y + height - ((secondaryValues[i] - paddedMin) / paddedRange) * height;
      doc.line(prevSX, prevSY, currX, currY);
      prevSX = currX;
      prevSY = currY;
    }
    doc.setLineDashPattern([], 0);
  }

  // subtle baseline
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.75);
  doc.line(x, y + height + 6, x + width, y + height + 6);
  doc.setDrawColor(...color);

  // min/max labels positioned along the curve
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  const minX = x + (minIndex / (values.length - 1 || 1)) * width;
  const minY = y + height - ((values[minIndex] - paddedMin) / paddedRange) * height;
  const maxX = x + (maxIndex / (values.length - 1 || 1)) * width;
  const maxY = y + height - ((values[maxIndex] - paddedMin) / paddedRange) * height;

  const drawCurrencyLabel = (
    label: string,
    anchorX: number,
    anchorY: number,
    align: "left" | "right"
  ) => {
    const padding = 3;
    const textWidth = doc.getTextWidth(label);
    const rectWidth = textWidth + padding * 2;
    const rectHeight = 14;
    const rectX = align === "right" ? anchorX - rectWidth : anchorX;
    const rectY = anchorY + 6;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(rectX, rectY, rectWidth, rectHeight, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    const textX = align === "right" ? anchorX - padding : rectX + padding;
    doc.text(label, textX, rectY + rectHeight - 4, {
      align: align === "right" ? "right" : "left",
    });
  };

  drawCurrencyLabel(formatCurrency(values[minIndex]), minX + 6, minY + 2, "left");
  drawCurrencyLabel(formatCurrency(values[maxIndex]), maxX - 6, maxY + 2, "right");

  // timeline labels
  let timelineBottom = y + height;
  if (dates && dates.length > 0) {
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const timelineY = y + height + 18; // closer to the chart, dates directly under
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);

    const drawDatePill = (label: string, posX: number, align: "left" | "right") => {
      const padding = 5;
      const textW = doc.getTextWidth(label);
      const pillW = textW + padding * 2;
      const pillH = 14;
      const pillX = align === "right" ? posX - pillW : posX;
      const pillY = timelineY - 6; // drop slightly to separate from line
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(pillX, pillY, pillW, pillH, 3, 3, "F");
      const textX = align === "right" ? posX - padding : pillX + padding;
      doc.setTextColor(71, 85, 105);
      doc.text(label, textX, pillY + pillH - 4, { align: align === "right" ? "right" : "left" });
    };

    drawDatePill(firstDate || "Start", x, "left");
    drawDatePill(lastDate || "Today", x + width, "right");
    timelineBottom = timelineY + 10;
  }

  return timelineBottom;
}

export async function generatePortfolioPDF(
  results: PortfolioResults,
  optimizer: Optimizer,
  lookbackPeriod: Lookback,
  includeDividends: boolean
): Promise<void> {
  if (!results || !results.weights?.length) {
    throw new Error("No portfolio results available to export.");
  }

  const doc = new jsPDF({
    unit: "pt",
    format: "letter",
    compress: true,
  });

  const docWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;

  // Header banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, docWidth, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Risk Budgeting Portfolio Report", margin, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const generatedAt = new Date().toLocaleString();
  doc.text(`Generated: ${generatedAt}`, margin, 70);
  if (results.asOf) {
    const asOfLabel = `Data as of: ${results.asOf}`;
    const textWidth = doc.getTextWidth(asOfLabel);
    doc.text(asOfLabel, docWidth - margin - textWidth, 70);
  }

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);

  // Strategy summary block
  const summaryTop = 96;
  const summaryHeight = 80;
  doc.setFillColor(240, 253, 244);
  doc.roundedRect(margin, summaryTop, docWidth - margin * 2, summaryHeight, 10, 10, "F");
  doc.setFont("helvetica", "bold");
  doc.text("Strategy Overview", margin + 16, summaryTop + 24);
  doc.setFont("helvetica", "normal");
  doc.text(`Optimizer: ${OPTIMIZER_LABELS[optimizer]}`, margin + 16, summaryTop + 44);
  doc.text(`Lookback: ${LOOKBACK_LABELS[lookbackPeriod] ?? lookbackPeriod}`, margin + 16, summaryTop + 60);
  const dividendLabel = includeDividends ? "Returns include dividend reinvestment" : "Dividends excluded from calculations";
  doc.text(dividendLabel, margin + 16, summaryTop + 76);
  
  if (results.volatilityTargeting?.targetVol || results.volatilityTargeting?.leverage) {
    const vt = results.volatilityTargeting;
    const vtText = `Target Vol: ${formatPercent(vt.targetVol)} | Realized Vol: ${formatPercent(vt.realizedVol)} | Leverage: ${vt.leverage ?? "Natural"}`;
    const textWidth = doc.getTextWidth(vtText);
    doc.text(vtText, docWidth - margin - textWidth - 16, summaryTop + 44);
  }

  let startY = summaryTop + summaryHeight + 25;

  // Backtest metrics
  if (results.analytics?.backtest) {
    const backtest = results.analytics.backtest;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(8, 47, 73);
    doc.text("Backtest Results", margin, startY);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "normal");
    startY += 16;

    const backtestRows: (string | number)[][] = [
      ["Total Return", formatPercent(backtest.totalReturn)],
      ["Annualized Return", formatPercent(backtest.annualizedReturn)],
      ["Annualized Volatility", formatPercent(backtest.annualizedVolatility)],
      ["Sharpe Ratio", formatNumber(backtest.sharpeRatio)],
      ["Max Drawdown", formatPercent(backtest.maxDrawdown)],
      ["Final Portfolio Value", formatCurrency(backtest.finalValue)],
      ["Rebalance Count", backtest.rebalanceCount?.toString() ?? "—"],
      [
        includeDividends ? "Dividends Reinvested" : "Dividends Paid in Cash",
        formatCurrency(includeDividends ? (backtest.dividendCashIfReinvested ?? backtest.dividendCash) : backtest.dividendCash)
      ],
    ];

    autoTable(doc, {
      startY,
      margin: { left: margin, right: margin },
      head: [["Historical Performance", "Value"]],
      body: backtestRows,
      styles: { fontSize: 11, cellPadding: 6, textColor: [15, 23, 42] },
      headStyles: { fillColor: [5, 150, 105], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 253, 244] },
      theme: "grid",
    });

    startY = (doc as any).lastAutoTable.finalY + 24;
  }

  // Check if new page needed
  if (startY > pageHeight - 150) {
    doc.addPage();
    startY = margin;
  }

  // Current portfolio snapshot section
  if (results.weights?.length) {
    if (startY > pageHeight - 280) {
      doc.addPage();
      startY = margin;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(8, 47, 73);
    doc.text("Historical Portfolio Snapshot", margin, startY);
    startY += 18;

    const portfolioSeries = results.analytics?.backtest?.portfolioValues;
    if (portfolioSeries && portfolioSeries.length > 1) {
      const chartHeight = 140;
      const chartWidth = docWidth - margin * 2;
      startY =
        drawValueLineChart(doc, {
          values: portfolioSeries,
          x: margin,
          y: startY,
          width: chartWidth,
          height: chartHeight,
          color: [88, 28, 135],
          dates: results.analytics?.backtest?.dates,
        }) + 18;
    }

    if (results.livePerformance) {
      const live = results.livePerformance;
      const blockHeight = 70;
      if (startY + blockHeight > pageHeight - 120) {
        doc.addPage();
        startY = margin;
      }
      doc.setFillColor(219, 234, 254);
      doc.roundedRect(margin, startY, docWidth - margin * 2, blockHeight, 10, 10, "F");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("Live Performance", margin + 16, startY + 22);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Window: ${live.startDate || "Creation"} → ${live.endDate || "Today"}`,
        margin + 16,
        startY + 40
      );
      doc.text(
        `Total Return: ${formatPercent(live.totalReturnPct)}`,
        margin + 16,
        startY + 56
      );
      doc.text(
        `Current Value: ${formatCurrency(live.finalValue)}`,
        margin + 240,
        startY + 56
      );
      startY += blockHeight + 24;
    }

    if (results.performanceSinceCreationSeries?.length) {
      // Guard: if series is flat/empty (all zeros or single point), skip rendering
      const hasData = results.performanceSinceCreationSeries.some(
        (p) => Number.isFinite(p.portfolioValue) && Math.abs(p.portfolioValue) > 0
      );
      if (!hasData || results.performanceSinceCreationSeries.length < 2) {
        // Still advance spacing minimally
        if (startY > pageHeight - 120) {
          doc.addPage();
          startY = margin;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(88, 28, 135);
        doc.text("Performance Since Portfolio Creation", margin, startY);
        startY += 18;
      } else {
      if (startY > pageHeight - 260) {
        doc.addPage();
        startY = margin;
      }
      const creationValues = results.performanceSinceCreationSeries.map((p) => p.portfolioValue);
      const creationDates = results.performanceSinceCreationSeries.map((p) => p.date ?? "");
      const hasBenchmark = results.performanceSinceCreationSeries.some(
        (p) => typeof p.benchmarkValue === "number"
      );
      const benchmarkValues = hasBenchmark
        ? results.performanceSinceCreationSeries.map((p) => p.benchmarkValue ?? 0)
        : undefined;
      const benchmarkLabel =
        results.performanceSinceCreationBenchmark || "Benchmark";

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(88, 28, 135);
      doc.text("Performance Since Portfolio Creation", margin, startY);
      startY += 12;

      const chartHeight = 200;
      startY =
        drawValueLineChart(doc, {
          values: creationValues,
          secondaryValues: benchmarkValues,
          x: margin,
          y: startY,
          width: docWidth - margin * 2,
          height: chartHeight,
          color: [139, 92, 246],
          dates: creationDates,
        }) + 18;

      const legendY = startY + 8;
      doc.setLineWidth(2);
      doc.setDrawColor(139, 92, 246);
      doc.line(margin, legendY, margin + 18, legendY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text("Portfolio", margin + 24, legendY + 3);

      const portfolioReturn =
        creationValues.length > 1 && creationValues[0] !== 0
          ? ((creationValues[creationValues.length - 1] - creationValues[0]) / creationValues[0]) * 100
          : 0;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(
        `${portfolioReturn >= 0 ? "+" : ""}${portfolioReturn.toFixed(2)}%`,
        margin + 60,
        legendY + 3
      );

      if (hasBenchmark && benchmarkValues) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(71, 85, 105);
        doc.setDrawColor(148, 163, 184);
        doc.setLineDashPattern([4, 3], 0);
        doc.line(margin + 140, legendY, margin + 158, legendY);
        doc.setLineDashPattern([], 0);
        const benchmarkLabelText = `Benchmark (${benchmarkLabel})`;
        doc.text(benchmarkLabelText, margin + 164, legendY + 3);

        const benchmarkReturn =
          benchmarkValues.length > 1 && benchmarkValues[0] !== 0
            ? ((benchmarkValues[benchmarkValues.length - 1] - benchmarkValues[0]) / benchmarkValues[0]) * 100
            : 0;
        const labelWidth = doc.getTextWidth(benchmarkLabelText);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(107, 114, 128);
        doc.text(
          `${benchmarkReturn >= 0 ? "+" : ""}${benchmarkReturn.toFixed(2)}%`,
          margin + 164 + labelWidth + 16,
          legendY + 5
        );
      }

      startY = legendY + 28;
      }
    }

    if (results.currentPerformanceSeries?.length) {
      if (startY > pageHeight - 200) {
        doc.addPage();
        startY = margin;
      }
      const seriesValues = results.currentPerformanceSeries.map((p) => p.value);
      const seriesDates = results.currentPerformanceSeries.map((p) => p.date ?? "");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(88, 28, 135);
      doc.text("Current Portfolio Performance (Value Mode)", margin, startY);
      startY += 12;
      const chartHeight = 120;
      startY =
        drawValueLineChart(doc, {
          values: seriesValues,
          x: margin,
          y: startY,
          width: docWidth - margin * 2,
          height: chartHeight,
          color: [126, 34, 206],
          dates: seriesDates,
        }) + 18;
    }

    if (startY > pageHeight - 200) {
      doc.addPage();
      startY = margin;
    }

    autoTable(doc, {
      startY,
      margin: { left: margin, right: margin },
      head: [["Current Asset Proposition", "Ticker", "Weight", "Current Risk Contribution"]],
      body: results.weights.map((weight) => [
        weight.name,
        weight.ticker,
        formatPercent(weight.weight),
        formatPercent(weight.riskContribution),
      ]),
      styles: { fontSize: 11, cellPadding: 6, textColor: [15, 23, 42] },
      headStyles: { fillColor: [8, 47, 73], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 249, 255] },
      theme: "striped",
    });

    startY = (doc as any).lastAutoTable.finalY + 24;
  }

  // Comparison table vs equal weight
  if (results.analytics?.comparison?.riskBudgeting && results.analytics?.comparison?.equalWeight) {
    const comparison = results.analytics.comparison;
    
    // Check if new page needed
    if (startY > pageHeight - 150) {
      doc.addPage();
      startY = margin;
    }
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Strategy Comparison", margin, startY);
    startY += 16;

    const comparisonRows: (string | number)[][] = [
      [
        "Risk Budgeting",
        formatPercent(comparison.riskBudgeting?.return),
        formatPercent(comparison.riskBudgeting?.volatility),
        formatNumber(comparison.riskBudgeting?.sharpe),
        formatPercent(comparison.riskBudgeting?.maxDrawdown),
      ],
      [
        "Equal Weight",
        formatPercent(comparison.equalWeight?.return),
        formatPercent(comparison.equalWeight?.volatility),
        formatNumber(comparison.equalWeight?.sharpe),
        formatPercent(comparison.equalWeight?.maxDrawdown),
      ],
    ];

    autoTable(doc, {
      startY,
      margin: { left: margin, right: margin },
      head: [["Strategy", "Return", "Volatility", "Sharpe", "Max Drawdown"]],
      body: comparisonRows,
      styles: { fontSize: 11, cellPadding: 6, textColor: [15, 23, 42] },
      headStyles: { fillColor: [14, 165, 233], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 249, 255] },
      theme: "grid",
    });

    startY = (doc as any).lastAutoTable.finalY + 24;
  }

  // Correlation matrix block
  if (results.correlationMatrix?.length && results.weights?.length) {
    if (startY > pageHeight - 200) {
      doc.addPage();
      startY = margin;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text("Asset Correlation Matrix", margin, startY);
    startY += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(
      "Correlations are based on price returns (dividends excluded) to focus purely on co-movement of assets.",
      margin,
      startY
    );
    startY += 16;

    // Highlight note block
    const noteHeight = 42;
    doc.setFillColor(237, 233, 254);
    doc.setDrawColor(139, 92, 246);
    doc.roundedRect(margin, startY, docWidth - margin * 2, noteHeight, 8, 8, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(76, 29, 149);
    doc.text(
      "Lower correlations signal stronger diversification benefits. Aim for a mix of low and negative correlations to reduce overall portfolio risk.",
      margin + 12,
      startY + 18,
      { maxWidth: docWidth - margin * 2 - 24 }
    );
    startY += noteHeight + 16;

    const tickers = results.weights.map((w) => w.ticker);
    const headRow = ["Asset", ...tickers];
    const bodyRows = results.correlationMatrix.map((row, idx) => [
      results.weights[idx]?.ticker ?? `Asset ${idx + 1}`,
      ...row.map((corr) => corr.toFixed(2)),
    ]);

    autoTable(doc, {
      startY,
      margin: { left: margin, right: margin },
      head: [headRow],
      body: bodyRows,
      styles: { fontSize: 9, cellPadding: 4, textColor: [15, 23, 42] },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      theme: "grid",
    });

    startY = (doc as any).lastAutoTable.finalY + 12;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`Average Correlation: ${formatNumber(results.avgCorrelation)}`, margin, startY);
    startY += 16;
  }

  // Footer
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Generated by the QARM Risk Budgeting engine.", margin, pageHeight - 42);
  doc.text(
    "Disclaimer: Informational use only. This is not investment advice and past performance does not guarantee future results.",
    margin,
    pageHeight - 28
  );

  const fileName = `risk-budgeting-${results.asOf ?? "report"}.pdf`.replace(/[\s:]/g, "-").toLowerCase();
  doc.save(fileName);
}
