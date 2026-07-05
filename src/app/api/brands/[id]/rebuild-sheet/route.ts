import { auth } from '@/lib/auth';
import { rebuildBrandSheet } from '@/lib/google-sheets';
import { unauthorized, internalError } from '@/lib/error-response';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return unauthorized();
  try {
    const { id } = await params;
    await rebuildBrandSheet(id);
    return Response.json({ ok: true });
  } catch (error) {
    return internalError(error);
  }
}
