"use client";

interface ProgressBarProps {
  total: number;
  completed: number;
  status: string;
}

export default function ProgressBar({ total, completed, status }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: '#ffffff', border: '1px solid #e8e8e5' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
          {status === 'completed' ? '分析完成' : status === 'error' ? '分析出錯' : '分析進行中...'}
        </span>
        <span className="text-sm" style={{ color: '#6b6b6b' }}>
          {completed} / {total}（{pct}%）
        </span>
      </div>
      <div className="w-full h-2 rounded-full" style={{ backgroundColor: '#f5f5f3' }}>
        <div
          className="h-2 rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: status === 'error' ? '#c75c5c' : status === 'completed' ? '#7a9e7e' : '#2d2d2d',
          }}
        />
      </div>
    </div>
  );
}
