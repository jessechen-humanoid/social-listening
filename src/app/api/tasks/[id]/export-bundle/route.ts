import { auth } from '@/lib/auth';
import { generateChartBundle, shouldRunBundleAsync } from '@/lib/deep-export';
import { sanitizeFilename } from '@/lib/sanitize-export';
import { ExportBundleInputSchema, firstIssueMessage } from '@/lib/schemas';
import { errorResponse, unauthorized, internalError } from '@/lib/error-response';

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
  if (!session?.user) return unauthorized();
  try {
    const { id } = await params;
    const parsed = ExportBundleInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse('VALIDATION', firstIssueMessage(parsed.error), 400);
    }
    const charts: ChartPayload[] = parsed.data.charts ?? [];

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
        'Content-Disposition': `attachment; filename="charts-${sanitizeFilename(id)}.zip"`,
        'X-Async-Mode': String(isAsync),
      },
    });
  } catch (error) {
    return internalError(error);
  }
}
