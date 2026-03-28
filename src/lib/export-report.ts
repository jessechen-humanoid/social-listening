import type { TaskResult } from './types';

export function exportReportCSV(results: TaskResult[], hasCondition: boolean, projectName: string = '') {
  const BOM = '\uFEFF';
  const headers = [
    'content',
    ...(hasCondition ? ['condition_result'] : []),
    'x_score',
    'y_score',
    'source_file',
    'engagement',
  ];

  const rows = results
    .filter(r => r.status === 'completed')
    .map(r => [
      escapeCsv(r.content_text),
      ...(hasCondition ? [r.condition_result === null ? '' : String(r.condition_result)] : []),
      r.x_score !== null ? String(r.x_score) : '',
      r.y_score !== null ? String(r.y_score) : '',
      escapeCsv(r.source_file || ''),
      r.engagement_value !== null ? String(r.engagement_value) : '',
    ]);

  const csv = BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.download = projectName ? `${projectName}_輿情分析報表.csv` : '輿情分析報表.csv';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
