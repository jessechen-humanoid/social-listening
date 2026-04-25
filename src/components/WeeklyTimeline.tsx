"use client";

import { useEffect, useRef, useCallback } from 'react';
import type { WeeklyBucket } from '@/lib/deep-pipeline/aggregate';

interface WeeklyTimelineProps {
  buckets: WeeklyBucket[];
  // Brand-configurable colors. Defaults match design.md.
  positiveColor?: string;
  negativeColor?: string;
  title?: string;
}

const DEFAULT_POSITIVE = '#3B82F6';
const DEFAULT_NEGATIVE = '#EF4444';

export default function WeeklyTimeline({
  buckets,
  positiveColor = DEFAULT_POSITIVE,
  negativeColor = DEFAULT_NEGATIVE,
  title,
}: WeeklyTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      drawTimeline(ctx, width, height, buckets, positiveColor, negativeColor, title);
    },
    [buckets, positiveColor, negativeColor, title]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.scale(dpr, dpr);
    draw(ctx, displayW, displayH);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-xl"
      style={{ height: 360, backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}
    />
  );
}

function drawTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  buckets: WeeklyBucket[],
  positiveColor: string,
  negativeColor: string,
  title: string | undefined
) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const margin = { top: 50, right: 40, bottom: 70, left: 60 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  if (title) {
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, 24);
  }

  if (buckets.length === 0) {
    ctx.fillStyle = '#6b6b6b';
    ctx.font = '12px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return;
  }

  const maxAbs = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.positive_weight, b.negative_weight))
  );
  const yScale = plotH / (maxAbs * 2);
  const midY = margin.top + plotH / 2;
  const barW = plotW / buckets.length;

  // Mid axis line
  ctx.strokeStyle = '#c0c0c0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, midY);
  ctx.lineTo(width - margin.right, midY);
  ctx.stroke();

  // Bars
  buckets.forEach((b, i) => {
    const x = margin.left + i * barW + barW * 0.15;
    const w = barW * 0.7;

    if (b.positive_weight > 0) {
      ctx.fillStyle = positiveColor;
      const h = b.positive_weight * yScale;
      ctx.fillRect(x, midY - h, w, h);
    }
    if (b.negative_weight > 0) {
      ctx.fillStyle = negativeColor;
      const h = b.negative_weight * yScale;
      ctx.fillRect(x, midY, w, h);
    }
  });

  // X-axis tick labels (rotated)
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '10px Arial, sans-serif';
  ctx.textAlign = 'right';
  buckets.forEach((b, i) => {
    const x = margin.left + i * barW + barW / 2;
    ctx.save();
    ctx.translate(x, height - margin.bottom + 14);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(b.week_start, 0, 0);
    ctx.restore();
  });

  // Y-axis labels
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '11px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(maxAbs.toFixed(1), margin.left - 6, margin.top + 4);
  ctx.fillText('0', margin.left - 6, midY + 4);
  ctx.fillText('-' + maxAbs.toFixed(1), margin.left - 6, height - margin.bottom + 4);

  // Legend
  ctx.font = '11px Arial, sans-serif';
  ctx.textAlign = 'left';
  const legendY = height - 18;
  ctx.fillStyle = positiveColor;
  ctx.fillRect(margin.left, legendY - 9, 12, 12);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('正向（好感 > 5）', margin.left + 18, legendY);
  ctx.fillStyle = negativeColor;
  ctx.fillRect(margin.left + 130, legendY - 9, 12, 12);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('負向（好感 < 5）', margin.left + 148, legendY);
}

// Render a 1600x900 PNG (per spec) and trigger a download.
export function exportWeeklyTimelinePNG(
  buckets: WeeklyBucket[],
  positiveColor: string,
  negativeColor: string,
  title: string,
  filename: string
) {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  drawTimeline(ctx, 1600, 900, buckets, positiveColor, negativeColor, title);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
