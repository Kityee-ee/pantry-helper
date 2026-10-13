import { requireManager } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

// Placeholder. The lane that owns this route replaces the body.
// In this Next.js version `params` is a Promise and must be awaited.
export default async function OrderDetailPage({ params }: PageProps<"/manager/order/[id]">) {
  await requireManager();
  const { id } = await params;

  return (
    <>
      <PageHeader title="Order" description={`Order ${id}`} />
      <Card>
        <p className="text-sm text-muted">Order lines, edits, summary and the place-order button go here.</p>
      </Card>
    </>
  );
}
