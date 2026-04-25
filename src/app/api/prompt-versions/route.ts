import { listPromptVersions } from '@/lib/prompt-versions';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage') as
      | Parameters<typeof listPromptVersions>[0]
      | null;
    const versions = await listPromptVersions(stage ?? undefined);
    return Response.json({
      versions: versions.map((v) => ({
        id: v.id,
        stage_name: v.stage_name,
        version_label: v.version_label,
        model_snapshot: v.model_snapshot,
        active: v.active,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
