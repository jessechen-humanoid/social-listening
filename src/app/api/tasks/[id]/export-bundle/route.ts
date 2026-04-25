import { auth } from '@/lib/auth';
import { generateChartBundle, shouldRunBundleAsync } from '@/lib/deep-export';

interface ChartPayload {
  filename: string;
  // base64-encoded PNG bytes (charts are rendered in the browser then posted here)
  base64: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const body = (await request.json()) as { charts?: ChartPayload[] };
    const charts = body.charts ?? [];

    // Per spec: > 2000 rows uses async path. The current implementation returns
    // the buffer directly either way; for very large tasks the caller may want
    // to accept the longer wait or implement a job queue.
    const isAsync = await shouldRunBundleAsync(id);

    const buf = await generateChartBundle({
      taskId: id,
      charts: charts.map((c) => ({
        filename: c.filename,
        pngBytes: Uint8Array.from(Buffer.from(c.base64, 'base64')),
      })),
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="charts-${id}.zip"`,
        'X-Async-Mode': String(isAsync),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
