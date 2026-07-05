"use client";

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { applyJitter } from '@/lib/jitter';
import { engagementWeight } from '@/lib/engagement-weight';
import type { TaskResult } from '@/lib/types';

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

// Default alpha tuned for regular volumes (Python parity: c='b', ~0.4).
// High-volume brands lower these via platform_settings.scatter_alpha.
// Module constant: an inline default object would be a new reference every
// render and permanently invalidate the draw useCallback below.
const DEFAULT_PLATFORM_ALPHA: Record<string, number> = {
  fb: 0.4, ig: 0.4, threads: 0.4, dcard: 0.4,
};

const QUADRANT_LABELS = [
  { name: '超級黑粉', x: 0, y: 1 },   // upper-left
  { name: '超級鐵粉', x: 1, y: 1 },   // upper-right
  { name: '理性黑粉', x: 0, y: 0 },   // lower-left
  { name: '理性粉絲', x: 1, y: 0 },   // lower-right
];

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

export default function ScatterPlot({
  results,
  xAxisName,
  yAxisName,
  conditionFilterEnabled,
  conditionText,
  dotColor = '#404040',
  exportMode = false,
  weighted = false,
  platformAlpha = DEFAULT_PLATFORM_ALPHA,
}: ScatterPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const filteredResults = useMemo(() => results.filter(r => {
    if (weighted) {
      const d = r as TaskResult & DeepResultFields;
      if (d.filtered_out || d.not_real_user) return false;
      const x = d.favor_calibrated ?? r.x_score;
      const y = d.emotion_calibrated ?? r.y_score;
      return x !== null && x !== undefined && y !== null && y !== undefined;
    }
    if (r.status !== 'completed' || r.x_score === null || r.y_score === null) return false;
    if (conditionFilterEnabled && conditionText) {
      return r.condition_result === true;
    }
    return true;
  }), [results, weighted, conditionFilterEnabled, conditionText]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const bgColor = exportMode ? '#ffffff' : '#fafaf8';
    const textColor = exportMode ? '#1a1a1a' : '#1a1a1a';
    const gridColor = exportMode ? '#e8e8e5' : '#f0f0ed';
    const quadLineColor = exportMode ? '#c0c0c0' : '#e8e8e5';
    const pointColor = dotColor;

    const margin = { top: 40, right: 40, bottom: 60, left: 60 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const scaleX = (v: number) => margin.left + (v / 10) * plotW;
    const scaleY = (v: number) => margin.top + ((10 - v) / 10) * plotH;

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = gridColor;
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

    // Quadrant dividers (thicker)
    ctx.strokeStyle = quadLineColor;
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

    // Axis tick labels
    ctx.fillStyle = textColor;
    ctx.font = '12px Arial, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 10; i += 2) {
      ctx.fillText(String(i), scaleX(i), height - margin.bottom + 20);
    }
    ctx.textAlign = 'right';
    for (let i = 0; i <= 10; i += 2) {
      ctx.fillText(String(i), margin.left - 10, scaleY(i) + 4);
    }

    // Axis labels
    ctx.fillStyle = textColor;
    ctx.font = '14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(xAxisName, width / 2, height - 10);
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yAxisName, 0, 0);
    ctx.restore();

    // Prepare point data
    const maxEngagement = Math.max(
      ...filteredResults.map(r => r.engagement_value || 0),
      1
    );
    const baseRadius = 4;
    const scaleFactor = 12 / Math.sqrt(maxEngagement);

    const points = filteredResults.map(r => {
      const d = r as TaskResult & DeepResultFields;
      const xRaw = weighted ? d.favor_calibrated ?? r.x_score! : r.x_score!;
      const yRaw = weighted ? d.emotion_calibrated ?? r.y_score! : r.y_score!;
      const { jx, jy } = applyJitter(Number(xRaw), Number(yRaw), r.row_index);
      const eng = r.engagement_value || 0;
      // Radius via the shared weight function (sqrt(e+1)) so chart sizing and
      // aggregate weighting can never drift apart.
      const radius = baseRadius + (engagementWeight(eng) - 1) * scaleFactor;
      const alpha = weighted && d.platform
        ? platformAlpha[d.platform] ?? 0.1
        : 0.35;
      // rawX/rawY: statistics use unjittered scores; jitter moves pixels only.
      return { x: jx, y: jy, rawX: Number(xRaw), rawY: Number(yRaw), radius, engagement: eng, alpha };
    });

    // Quadrant labels are rendered outside the chart in page.tsx, not inside the canvas

    // Data points
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(scaleX(p.x), scaleY(p.y), p.radius, 0, Math.PI * 2);
      ctx.fillStyle = pointColor;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
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
      const arm = 10;

      ctx.strokeStyle = '#c75c5c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - arm, sy);
      ctx.lineTo(sx + arm, sy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx, sy - arm);
      ctx.lineTo(sx, sy + arm);
      ctx.stroke();

      ctx.fillStyle = '#c75c5c';
      ctx.font = '11px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`(${cx}, ${cy})`, sx + 14, sy - 6);
    }
  }, [filteredResults, xAxisName, yAxisName, dotColor, exportMode, weighted, platformAlpha]);

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
      className="w-full rounded-xl"
      style={{
        height: 500,
        backgroundColor: exportMode ? '#ffffff' : '#fafaf8',
        border: exportMode ? 'none' : '1px solid #e8e8e5',
      }}
    />
  );
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
) {
  const width = 1000;
  const height = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // We need to replicate the draw logic for export
  const bgColor = '#ffffff';
  const textColor = '#1a1a1a';
  const gridColor = '#e8e8e5';
  const quadLineColor = '#c0c0c0';
  const pointColor = dotColor;

  const margin = { top: 60, right: 40, bottom: 80, left: 80 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const scaleX = (v: number) => margin.left + (v / 10) * plotW;
  const scaleY = (v: number) => margin.top + ((10 - v) / 10) * plotH;

  const filteredResults = results.filter(r => {
    if (r.status !== 'completed' || r.x_score === null || r.y_score === null) return false;
    if (conditionFilterEnabled && conditionText) return r.condition_result === true;
    return true;
  });

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  // Grid
  ctx.strokeStyle = gridColor;
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

  // Quadrant dividers
  ctx.strokeStyle = quadLineColor;
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

  // Tick labels
  ctx.fillStyle = textColor;
  ctx.font = '16px Arial, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 10; i += 2) {
    ctx.fillText(String(i), scaleX(i), height - margin.bottom + 28);
  }
  ctx.textAlign = 'right';
  for (let i = 0; i <= 10; i += 2) {
    ctx.fillText(String(i), margin.left - 12, scaleY(i) + 6);
  }

  // Axis labels
  ctx.fillStyle = textColor;
  ctx.font = '16px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(xAxisName, width / 2, height - 10);
  ctx.save();
  ctx.translate(18, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yAxisName, 0, 0);
  ctx.restore();

  // Points
  const maxEng = Math.max(...filteredResults.map(r => r.engagement_value || 0), 1);
  const baseR = 5;
  const sf = 15 / Math.sqrt(maxEng);

  const points = filteredResults.map(r => {
    const { jx, jy } = applyJitter(r.x_score!, r.y_score!, r.row_index);
    const eng = r.engagement_value || 0;
    const radius = baseR + (engagementWeight(eng) - 1) * sf;
    return { x: jx, y: jy, rawX: r.x_score!, rawY: r.y_score!, radius, engagement: eng };
  });

  // Quadrant labels — computed from UNJITTERED scores so the exported PNG
  // always matches the on-screen percentages.
  const quadCounts = computeQuadrantCounts(points.map(p => ({ x: p.rawX, y: p.rawY })));
  const total = points.length || 1;
  const pcts = quadCounts.map(c => Math.round((c / total) * 100));
  ctx.fillStyle = textColor;
  ctx.font = '24px Arial, sans-serif';
  ctx.globalAlpha = 0.7;
  // Top row: upper-left and upper-right
  ctx.textAlign = 'left';
  ctx.fillText(mode === 'brand' ? `超級黑粉 ${pcts[0]}%` : `${pcts[0]}%`, margin.left, margin.top - 20);
  ctx.textAlign = 'right';
  ctx.fillText(mode === 'brand' ? `超級鐵粉 ${pcts[1]}%` : `${pcts[1]}%`, width - margin.right, margin.top - 20);
  // Bottom row: lower-left and lower-right
  ctx.textAlign = 'left';
  ctx.fillText(mode === 'brand' ? `理性黑粉 ${pcts[2]}%` : `${pcts[2]}%`, margin.left, height - margin.bottom + 50);
  ctx.textAlign = 'right';
  ctx.fillText(mode === 'brand' ? `理性粉絲 ${pcts[3]}%` : `${pcts[3]}%`, width - margin.right, height - margin.bottom + 50);
  ctx.globalAlpha = 1;

  // Data points
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(scaleX(p.x), scaleY(p.y), p.radius, 0, Math.PI * 2);
    ctx.fillStyle = pointColor;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Centroid — unjittered, same as on-screen.
  if (points.length > 0) {
    const { cx, cy } = computeCentroid(
      points.map(p => ({ x: p.rawX, y: p.rawY, engagement: p.engagement }))
    );
    const sx = scaleX(cx);
    const sy = scaleY(cy);
    const arm = 12;

    ctx.strokeStyle = '#c75c5c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx - arm, sy);
    ctx.lineTo(sx + arm, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, sy - arm);
    ctx.lineTo(sx, sy + arm);
    ctx.stroke();

    ctx.fillStyle = '#c75c5c';
    ctx.font = '24px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`(${cx}, ${cy})`, sx + 16, sy - 10);
  }

  // Download
  const link = document.createElement('a');
  link.download = projectName ? `${projectName}_輿情分析散佈圖.png` : '輿情分析散佈圖.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}
