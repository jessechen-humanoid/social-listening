import { auth } from '@/lib/auth';
import {
  BrandValidationError,
  createBrand,
  listBrands,
} from '@/lib/brands';
import { migrate } from '@/lib/migrate';

let migrated = false;
async function ensureMigrated() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await ensureMigrated();
    const brands = await listBrands();
    return Response.json({ brands });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await ensureMigrated();
    const body = await request.json();
    const { name } = body as { name?: string };

    if (typeof name !== 'string' || !name.trim()) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const brand = await createBrand(name);
    return Response.json({ brand }, { status: 201 });
  } catch (error) {
    if (error instanceof BrandValidationError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
