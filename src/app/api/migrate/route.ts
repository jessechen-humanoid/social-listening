import { migrate } from '@/lib/migrate';
import { requireSession } from '@/lib/require-session';

export async function POST() {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    await migrate();
    return Response.json({ success: true, message: 'Migration complete' });
  } catch (error) {
    // Full stack goes to the server log only — never into the response body.
    console.error('Migration failed:', error);
    const message = error instanceof Error ? error.message : 'Migration failed';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
