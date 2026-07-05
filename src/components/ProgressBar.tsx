"use client";

interface ProgressBarProps {
  total: number;
  completed: number;
  status: string;
}

export default function ProgressBar({ total, completed, status }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-line)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
          {status === 'completed' ? '分析完成' : status === 'error' ? '分析出錯' : '分析進行中...'}
        </span>
        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {completed} / {total}（{pct}%）
        </span>
      </div>
      <div className="w-full h-2 rounded-full" style={{ backgroundColor: '#f5f5f3' }}>
        <div
          className="h-2 rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: status === 'error' ? 'var(--color-danger)' : status === 'completed' ? 'var(--color-success)' : 'var(--color-accent)',
          }}
        />
      </div>
    </div>
  );
}
