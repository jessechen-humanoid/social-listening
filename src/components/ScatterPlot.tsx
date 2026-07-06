"use client";

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { applyJitter } from '@/lib/jitter';
import { engagementWeight } from '@/lib/engagement-weight';
import type { TaskResult } from '@/lib/types';
import { CHART_COLORS } from '@/lib/chart-colors';
import { sanitizeFilename } from '@/lib/sanitize-export';

interface ScatterPlotProps {
  results: TaskResult[];
  xAxisName: string;
  yAxisName: string;
  conditionFilterEnabled: boolean;
  conditionText: string;
  dotColor?: string;
  exportMode?: boolean;
  // Deep mode: render each point at its platform's alpha, use calibrated scores,
  // and exclude filtered_out / not_real_user rows. The caller passes a per-platform
  // alpha map (e.g., from `brand.platform_settings.scatter_alpha`).
  weighted?: boolean;
  platformAlpha?: Record<string, number>;
}

interface DeepResultFields {
  emotion_calibrated?: number | null;
  favor_calibrated?: number | null;
  filtered_out?: boolean | null;
  not_real_user?: boolean | null;
  platform?: string | null;
}

// Density-adaptive opacity via ink conservation (spec "Deep scatter default
// styling"): the legacy Python workflow hand-tuned alpha per quarter to keep
// the fog-like density constant; this formula automates that. Calibrated so
// the legacy Q1 Threads chart (6,225 points at alpha 0.1) reproduces exactly.
export const TARGET_INK_PX2 = 41537; // 60% of the legacy Q1 anchor — lighter register per acceptance
export const ADAPTIVE_ALPHA_MIN = 0.008;
export const ADAPTIVE_ALPHA_MAX = 0.4;

export function adaptiveAlpha(radiiOn1000px: number[]): number {
  const ink = radiiOn1000px.reduce((sum, r) => sum + r * r, 0);
  if (ink <= 0) return ADAPTIVE_ALPHA_MAX;
  return Math.min(ADAPTIVE_ALPHA_MAX, Math.max(ADAPTIVE_ALPHA_MIN, TARGET_INK_PX2 / ink));
}

// Stable empty default: no brand override → adaptive for every platform.
const NO_PLATFORM_OVERRIDES: Record<string, number> = {};

export function computeQuadrantCounts(points: { x: number; y: number }[]) {
  const counts = [0, 0, 0, 0]; // UL, UR, LL, LR
  for (const p of points) {
    const right = p.x >= 5.0;
    const upper = p.y >= 5.0;
    if (upper && !right) counts[0]++;
    else if (upper && right) counts[1]++;
    else if (!upper && !right) counts[2]++;
    else counts[3]++;
  }
  return counts;
}

function computeCentroid(points: { x: number; y: number; engagement: number }[]) {
  if (points.length === 0) return { cx: 5, cy: 5 };
  let totalWeight = 0;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    const w = engagementWeight(p.engagement);
    sumX += p.x * w;
    sumY += p.y * w;
    totalWeight += w;
  }
  return {
    cx: Math.round((sumX / totalWeight) * 10) / 10,
    cy: Math.round((sumY / totalWeight) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Shared point preparation + draw routine (spec "Single draw routine for
// screen and export"): both the on-screen canvas and the exported PNG call
// buildScatterPoints + drawScatter, so they can never disagree on which
// points are plotted or how. Size-dependent values arrive via options.
// ---------------------------------------------------------------------------

export interface ScatterPoint {
  x: number;      // jittered, for pixels
  y: number;
  rawX: number;   // unjittered, for statistics (spec "Quadrant statistics
  rawY: number;   // computed from unjittered scores")
  radius: number;
  engagement: number;
  alpha: number;
}

// Python area-equivalent sizing (spec "Engagement-based point sizing"):
// matplotlib used s = (sqrt(e) + 0.1) × 100 pt² on a 100-dpi figure, i.e.
// radius_px = sqrt(s/π) × 100/72 ≈ 7.84 × sqrt(sqrt(e) + 0.1) at 1000px width.
// Absolute scale — a given engagement renders the same size in every chart.
// Visual only: statistical weights stay sqrt(e+1) (附錄 D), deliberately
// decoupled from point size.
export const SIZE_COEF_1000PX = Math.sqrt(100 / Math.PI) * (100 / 72);
// Cap keeps high-engagement/low-count charts (e.g. IG brand posts) from being
// dominated by oversized circles (acceptance feedback 2026-07-06).
export const MAX_POINT_RADIUS_1000PX = 45;

export function pointRadius(engagement: number, canvasWidth: number): number {
  const uncapped = SIZE_COEF_1000PX * Math.sqrt(Math.sqrt(Math.max(0, engagement)) + 0.1);
  return Math.min(MAX_POINT_RADIUS_1000PX, uncapped) * (canvasWidth / 1000);
}

interface BuildPointsOptions {
  weighted: boolean;
  conditionFilterEnabled: boolean;
  conditionText: string;
  platformAlpha: Record<string, number>;
  canvasWidth: number; // sizing reference (1000 = export scale)
}

export function filterScatterResults(
  results: TaskResult[],
  opts: Pick<BuildPointsOptions, 'weighted' | 'conditionFilterEnabled' | 'conditionText'>
): TaskResult[] {
  return results.filter(r => {
    if (opts.weighted) {
      const d = r as TaskResult & DeepResultFields;
      if (d.filtered_out || d.not_real_user) return false;
      const x = d.favor_calibrated ?? r.x_score;
      const y = d.emotion_calibrated ?? r.y_score;
      return x !== null && x !== undefined && y !== null && y !== undefined;
    }
    if (r.status !== 'completed' || r.x_score === null || r.y_score === null) return false;
    if (opts.conditionFilterEnabled && opts.conditionText) {
      return r.condition_result === true;
    }
    return true;
  });
}

export function buildScatterPoints(
  filteredResults: TaskResult[],
  opts: BuildPointsOptions
): ScatterPoint[] {
  // Adaptive default is computed from the 1000px-reference radii of ALL
  // plotted points (ink conservation is a whole-chart property).
  const autoAlpha = adaptiveAlpha(
    filteredResults.map(r => pointRadius(r.engagement_value || 0, 1000))
  );
  return filteredResults.map(r => {
    const d = r as TaskResult & DeepResultFields;
    const xRaw = opts.weighted ? d.favor_calibrated ?? r.x_score! : r.x_score!;
    const yRaw = opts.weighted ? d.emotion_calibrated ?? r.y_score! : r.y_score!;
    const { jx, jy } = applyJitter(Number(xRaw), Number(yRaw), r.row_index);
    const eng = r.engagement_value || 0;
    const radius = pointRadius(eng, opts.canvasWidth);
    // A platform key present in the brand settings is an intentional fixed
    // override; an absent key means density-adaptive (spec "Platform
    // transparency configurable per brand").
    const alpha = opts.weighted
      ? (d.platform !== null && d.platform !== undefined ? opts.platformAlpha[d.platform] : undefined) ?? autoAlpha
      : 0.35;
    return { x: jx, y: jy, rawX: Number(xRaw), rawY: Number(yRaw), radius, engagement: eng, alpha };
  });
}

interface DrawSizes {
  margin: { top: number; right: number; bottom: number; left: number };
  tickFont: number;
  axisFont: number;
  tickOffsetX: number;   // distance below plot for x tick labels
  tickOffsetY: number;   // distance left of plot for y tick labels
  axisLabelInset: number; // rotated y-axis label x position
  centroidFont: number;
  centroidArm: number;
  centroidLine: number;
  centroidLabelDx: number;
  centroidLabelDy: number;
  quadrantFont: number;  // used only when quadrant labels are drawn in-canvas
  quadrantTopDy: number;    // offset above the plot for the top label row
  quadrantBottomDy: number; // offset below the plot for the bottom label row
}

interface DrawScatterOptions {
  width: number;
  height: number;
  points: ScatterPoint[];
  xAxisName: string;
  yAxisName: string;
  dotColor: string;
  bgColor: string;
  gridColor: string;
  quadLineColor: string;
  textColor: string;
  sizes: DrawSizes;
  // In-canvas quadrant labels (export only; the app renders them in HTML).
  quadrantLabels?: { mode: 'brand' | 'custom' };
}

export function drawScatter(ctx: CanvasRenderingContext2D, opts: DrawScatterOptions) {
  const { width, height, points, sizes } = opts;
  const { margin } = sizes;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const scaleX = (v: number) => margin.left + (v / 10) * plotW;
  const scaleY = (v: number) => margin.top + ((10 - v) / 10) * plotH;

  // Background
  ctx.fillStyle = opts.bgColor;
  ctx.fillRect(0, 0, width, height);

  // Grid lines
  ctx.strokeStyle = opts.gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(scaleX(i), margin.top);
    ctx.lineTo(scaleX(i), height - margin.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, scaleY(i));
    ctx.lineTo(width - margin.right, scaleY(i));
    ctx.stroke();
  }

  // Quadrant dividers (thicker, dashed)
  ctx.strokeStyle = opts.quadLineColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(scaleX(5), margin.top);
  ctx.lineTo(scaleX(5), height - margin.bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(margin.left, scaleY(5));
  ctx.lineTo(width - margin.right, scaleY(5));
  ctx.stroke();
  ctx.setLineDash([]);

  // Data points
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(scaleX(p.x), scaleY(p.y), p.radius, 0, Math.PI * 2);
    ctx.fillStyle = opts.dotColor;
    ctx.globalAlpha = p.alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Text layers render ABOVE the data points (spec "Chart text renders
  // above data points"): capped giant bubbles must never obscure labels.
  // Axis tick labels
  ctx.fillStyle = opts.textColor;
  ctx.font = `${sizes.tickFont}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  for (let i = 0; i <= 10; i += 2) {
    ctx.fillText(String(i), scaleX(i), height - margin.bottom + sizes.tickOffsetX);
  }
  ctx.textAlign = 'right';
  for (let i = 0; i <= 10; i += 2) {
    ctx.fillText(String(i), margin.left - sizes.tickOffsetY, scaleY(i) + sizes.tickFont / 3);
  }

  // Axis labels
  ctx.fillStyle = opts.textColor;
  ctx.font = `${sizes.axisFont}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(opts.xAxisName, width / 2, height - 10);
  ctx.save();
  ctx.translate(sizes.axisLabelInset, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(opts.yAxisName, 0, 0);
  ctx.restore();

  // Quadrant labels + percentages (in-canvas variant, spec "Scatter plot PNG
  // export": same external positions as the on-screen display).
  if (opts.quadrantLabels) {
    const counts = computeQuadrantCounts(points.map(p => ({ x: p.rawX, y: p.rawY })));
    const total = points.length || 1;
    const pcts = counts.map(c => Math.round((c / total) * 100));
    const brand = opts.quadrantLabels.mode === 'brand';
    ctx.fillStyle = opts.textColor;
    ctx.font = `${sizes.quadrantFont}px Arial, sans-serif`;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'left';
    ctx.fillText(brand ? `超級黑粉 ${pcts[0]}%` : `${pcts[0]}%`, margin.left, margin.top - sizes.quadrantTopDy);
    ctx.textAlign = 'right';
    ctx.fillText(brand ? `超級鐵粉 ${pcts[1]}%` : `${pcts[1]}%`, width - margin.right, margin.top - sizes.quadrantTopDy);
    ctx.textAlign = 'left';
    ctx.fillText(brand ? `理性黑粉 ${pcts[2]}%` : `${pcts[2]}%`, margin.left, height - margin.bottom + sizes.quadrantBottomDy);
    ctx.textAlign = 'right';
    ctx.fillText(brand ? `理性粉絲 ${pcts[3]}%` : `${pcts[3]}%`, width - margin.right, height - margin.bottom + sizes.quadrantBottomDy);
    ctx.globalAlpha = 1;
  }


  // Centroid — from unjittered scores (spec "Quadrant statistics computed
  // from unjittered scores").
  if (points.length > 0) {
    const { cx, cy } = computeCentroid(
      points.map(p => ({ x: p.rawX, y: p.rawY, engagement: p.engagement }))
    );
    const sx = scaleX(cx);
    const sy = scaleY(cy);

    ctx.strokeStyle = CHART_COLORS.danger;
    ctx.lineWidth = sizes.centroidLine;
    ctx.beginPath();
    ctx.moveTo(sx - sizes.centroidArm, sy);
    ctx.lineTo(sx + sizes.centroidArm, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, sy - sizes.centroidArm);
    ctx.lineTo(sx, sy + sizes.centroidArm);
    ctx.stroke();

    ctx.fillStyle = CHART_COLORS.danger;
    ctx.font = `${sizes.centroidFont}px Arial, sans-serif`;
    // Flip the label to the left of the cross when it would spill past the
    // plot's right edge (spec "Chart text renders above data points" — the
    // label must stay fully visible for right-leaning centroids).
    const label = `(${cx}, ${cy})`;
    const spills = sx + sizes.centroidLabelDx + ctx.measureText(label).width > width - margin.right;
    ctx.textAlign = spills ? 'right' : 'left';
    ctx.fillText(label, spills ? sx - sizes.centroidLabelDx : sx + sizes.centroidLabelDx, sy + sizes.centroidLabelDy);
  }
}

// Screen sizes: unchanged from the previous on-screen rendering.
const SCREEN_SIZES: DrawSizes = {
  margin: { top: 40, right: 40, bottom: 60, left: 60 },
  tickFont: 12,
  axisFont: 14,
  tickOffsetX: 20,
  tickOffsetY: 10,
  axisLabelInset: 15,
  centroidFont: 11,
  centroidArm: 10,
  centroidLine: 2,
  centroidLabelDx: 14,
  centroidLabelDy: -6,
  quadrantFont: 14,
  quadrantTopDy: 20,
  quadrantBottomDy: 22,
};

// Export sizes per spec "Scatter plot PNG export": 1000×1000, tick 42px,
// axis 48px, quadrant 42px, centroid 42px, cross line 7.5px / arm 36px,
// centroid label offset scaled proportionally to the enlarged arm.
const EXPORT_SIZES: DrawSizes = {
  // Margins sized so the 42/48px spec fonts have room: top/bottom label rows
  // sit clear of the tick labels and the axis title.
  margin: { top: 110, right: 60, bottom: 170, left: 110 },
  tickFont: 42,
  axisFont: 48,
  tickOffsetX: 52,
  tickOffsetY: 16,
  axisLabelInset: 42,
  centroidFont: 42,
  centroidArm: 36,
  centroidLine: 7.5,
  centroidLabelDx: 48,
  centroidLabelDy: -30,
  quadrantFont: 42,
  quadrantTopDy: 44,
  quadrantBottomDy: 122,
};

export default function ScatterPlot({
  results,
  xAxisName,
  yAxisName,
  conditionFilterEnabled,
  conditionText,
  dotColor = '#404040',
  exportMode = false,
  weighted = false,
  platformAlpha = NO_PLATFORM_OVERRIDES,
}: ScatterPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const filteredResults = useMemo(
    () => filterScatterResults(results, { weighted, conditionFilterEnabled, conditionText }),
    [results, weighted, conditionFilterEnabled, conditionText]
  );

  const draw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const points = buildScatterPoints(filteredResults, {
      weighted, conditionFilterEnabled, conditionText, platformAlpha,
      canvasWidth: width,
    });
    drawScatter(ctx, {
      width,
      height,
      points,
      xAxisName,
      yAxisName,
      dotColor,
      bgColor: exportMode ? CHART_COLORS.card : CHART_COLORS.paper,
      gridColor: exportMode ? CHART_COLORS.line : CHART_COLORS.lineSoft,
      quadLineColor: exportMode ? CHART_COLORS.faint : CHART_COLORS.line,
      textColor: CHART_COLORS.ink,
      sizes: SCREEN_SIZES,
      // Quadrant labels are rendered outside the chart in the page, not in-canvas.
    });
  }, [filteredResults, xAxisName, yAxisName, dotColor, exportMode, weighted, conditionFilterEnabled, conditionText, platformAlpha]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const displayW = canvas.clientWidth;
      const displayH = canvas.clientHeight;
      canvas.width = displayW * dpr;
      canvas.height = displayH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, displayW, displayH);
    };

    render();

    // Debounced redraw on resize: the bitmap is sized to the CSS box, so
    // without this a window resize leaves the chart stretched and blurry.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(render, 150);
    });
    observer.observe(canvas);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [draw]);

  return (
    <canvas
      data-chart="scatter"
      ref={canvasRef}
      role="img"
      aria-label={`${xAxisName} × ${yAxisName} 散佈圖，共 ${filteredResults.length} 點`}
      className="w-full rounded-xl"
      style={{
        height: 500,
        backgroundColor: exportMode ? CHART_COLORS.card : CHART_COLORS.paper,
        border: exportMode ? 'none' : '1px solid var(--color-line)',
      }}
    />
  );
}

// 1000×1000 presentation PNG (spec "Scatter plot PNG export") rendered by the
// SAME drawScatter routine as the on-screen chart, with export sizes.
// Returns a dataURL — shared by the single-task download button and the
// batch zip (spec "Batch results page with unified download": zipped charts
// are rendered off-screen at export dimensions, never screen-captured).
export function renderScatterPNG(
  results: TaskResult[],
  xAxisName: string,
  yAxisName: string,
  conditionFilterEnabled: boolean,
  conditionText: string,
  dotColor: string = '#404040',
  mode: 'brand' | 'custom' = 'brand',
  weighted: boolean = false,
  platformAlpha: Record<string, number> = NO_PLATFORM_OVERRIDES,
): string | null {
  const width = 1000;
  const height = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const filtered = filterScatterResults(results, { weighted, conditionFilterEnabled, conditionText });
  const points = buildScatterPoints(filtered, {
    weighted, conditionFilterEnabled, conditionText, platformAlpha,
    canvasWidth: width,
  });

  drawScatter(ctx, {
    width,
    height,
    points,
    xAxisName,
    yAxisName,
    dotColor,
    bgColor: CHART_COLORS.card,
    gridColor: CHART_COLORS.line,
    quadLineColor: CHART_COLORS.faint,
    textColor: CHART_COLORS.ink,
    sizes: EXPORT_SIZES,
    quadrantLabels: { mode },
  });

  return canvas.toDataURL('image/png');
}

export function exportScatterPlotPNG(
  results: TaskResult[],
  xAxisName: string,
  yAxisName: string,
  conditionFilterEnabled: boolean,
  conditionText: string,
  dotColor: string = '#404040',
  projectName: string = '',
  mode: 'brand' | 'custom' = 'brand',
  weighted: boolean = false,
  platformAlpha: Record<string, number> = NO_PLATFORM_OVERRIDES,
) {
  const url = renderScatterPNG(results, xAxisName, yAxisName, conditionFilterEnabled, conditionText, dotColor, mode, weighted, platformAlpha);
  if (!url) return;
  const link = document.createElement('a');
  link.download = projectName ? `${sanitizeFilename(projectName)}_輿情分析散佈圖.png` : '輿情分析散佈圖.png';
  link.href = url;
  link.click();
}
