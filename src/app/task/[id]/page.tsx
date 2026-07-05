import TaskResultView from '@/components/flows/TaskResultView';
import { FlowPage } from '@/components/flows/PageHeader';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FlowPage>
      <TaskResultView taskId={id} />
    </FlowPage>
  );
}
