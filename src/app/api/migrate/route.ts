import { migrate } from '@/lib/migrate';

export async function POST() {
  try {
    await migrate();
    return Response.json({ success: true, message: 'Migration complete' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
