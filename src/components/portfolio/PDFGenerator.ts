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
  dates?: string[];
  maxDrawdownPeriod?: {
    start?: string;
    end?: string;
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
  }
): number {
  const { values, x, y, width, height, color, dates } = opts;
  if (!values.length) return y;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  let minIndex = 0;
  let maxIndex = 0;
  doc.setLineWidth(1.5);
  doc.setDrawColor(...color);
  let prevX = x;
  let prevY = y + height - ((values[0] - min) / range) * height;
  for (let i = 1; i < values.length; i++) {
    const currX = x + (i / (values.length - 1)) * width;
    const currY = y + height - ((values[i] - min) / range) * height;
    doc.line(prevX, prevY, currX, currY);
    if (values[i] < values[minIndex]) minIndex = i;
    if (values[i] > values[maxIndex]) maxIndex = i;
    prevX = currX;
    prevY = currY;
  }

  // min/max labels positioned along the curve
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const minX = x + (minIndex / (values.length - 1)) * width;
  const minY = y + height - ((values[minIndex] - min) / range) * height;
  const maxX = x + (maxIndex / (values.length - 1)) * width;
  const maxY = y + height - ((values[maxIndex] - min) / range) * height;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 65, 85);
  doc.text(formatCurrency(values[minIndex]), minX + 4, minY + 12);
  doc.text(formatCurrency(values[maxIndex]), maxX - 4, maxY - 8, { align: "right" });

  // timeline labels
  if (dates && dates.length > 0) {
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(firstDate || "Start", x, y + height + 16);
    const lastWidth = doc.getTextWidth(lastDate || "Today");
    doc.text(lastDate || "Today", x + width - lastWidth, y + height + 16);
  }

  return y + height;
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
  const summaryTop = 110;
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

  // Portfolio metrics table
  const metricsRows: (string | number)[][] = [
    ["Expected Return", formatPercent(results.metrics?.expectedReturn)],
    ["Portfolio Volatility", formatPercent(results.metrics?.portfolioVolatility)],
    ["Sharpe Ratio", formatNumber(results.metrics?.sharpeRatio)],
    ["Max Drawdown", formatPercent(results.metrics?.maxDrawdown)],
  ];

  autoTable(doc, {
    startY,
    margin: { left: margin, right: margin },
    head: [["Historic Portfolio Metric", "Value"]],
    body: metricsRows,
    styles: { fontSize: 11, cellPadding: 6, textColor: [15, 23, 42] },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    theme: "grid",
  });

  startY = (doc as any).lastAutoTable.finalY + 24;

  // Check if new page needed
  if (startY > pageHeight - 150) {
    doc.addPage();
    startY = margin;
  }

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
