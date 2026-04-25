import { migrate } from '@/lib/migrate';

export async function POST() {
  try {
    await migrate();
    return Response.json({ success: true, message: 'Migration complete' });
  } catch (error) {
    console.error('Migration failed:', error);
    const message =
      error instanceof Error
        ? error.message + (error.stack ? '\n' + error.stack : '')
        : JSON.stringify(error);
    return Response.json({ success: false, error: message || 'Empty error' }, { status: 500 });
  }
}
