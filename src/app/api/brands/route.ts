import { errorResponse, unauthorized, internalError } from '@/lib/error-response';
import { BrandInputSchema, firstIssueMessage } from '@/lib/schemas';
import { auth } from '@/lib/auth';
import {
  BrandValidationError,
  createBrand,
  listBrands,
} from '@/lib/brands';
import { ensureMigrated } from '@/lib/ensure-migrated';

export async function GET() {
  const session = await auth();
  if (!session?.user) return unauthorized();

  try {
    await ensureMigrated();
    const brands = await listBrands();
    return Response.json({ brands });
  } catch (error) {
    return internalError(error);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  try {
    await ensureMigrated();
    const parsed = BrandInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse('VALIDATION', firstIssueMessage(parsed.error), 400);
    }

    const brand = await createBrand(parsed.data.name);
    return Response.json({ brand }, { status: 201 });
  } catch (error) {
    if (error instanceof BrandValidationError) {
      return errorResponse('CONFLICT', error.message, 409);
    }
    return internalError(error);
  }
}
