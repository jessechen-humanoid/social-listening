import { errorResponse, unauthorized, internalError } from '@/lib/error-response';
import { BrandSettingsSchema, firstIssueMessage } from '@/lib/schemas';
import { auth } from '@/lib/auth';
import {
  getBrand,
  listBrandTasks,
  updatePlatformSettings,
  type PlatformSettings,
} from '@/lib/brands';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  try {
    const { id } = await params;
    const brand = await getBrand(id);
    if (!brand) return errorResponse('NOT_FOUND', 'Brand not found', 404);
    const tasks = await listBrandTasks(id);
    return Response.json({ brand, tasks });
  } catch (error) {
    return internalError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  try {
    const { id } = await params;
    const parsed = BrandSettingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse('VALIDATION', firstIssueMessage(parsed.error), 400);
    }
    const brand = await updatePlatformSettings(id, parsed.data.platform_settings as Partial<PlatformSettings>);
    return Response.json({ brand });
  } catch (error) {
    return internalError(error);
  }
}
