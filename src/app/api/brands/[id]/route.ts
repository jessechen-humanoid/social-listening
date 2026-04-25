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
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const brand = await getBrand(id);
    if (!brand) return Response.json({ error: 'Brand not found' }, { status: 404 });
    const tasks = await listBrandTasks(id);
    return Response.json({ brand, tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const body = (await request.json()) as { platform_settings?: Partial<PlatformSettings> };
    if (!body.platform_settings) {
      return Response.json({ error: 'platform_settings is required' }, { status: 400 });
    }
    const brand = await updatePlatformSettings(id, body.platform_settings);
    return Response.json({ brand });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
