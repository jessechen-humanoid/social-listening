import BatchResultView from '@/components/flows/BatchResultView';
import { FlowPage } from '@/components/flows/PageHeader';

export default async function BatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return (
    <FlowPage>
      <BatchResultView batchId={batchId} />
    </FlowPage>
  );
}
