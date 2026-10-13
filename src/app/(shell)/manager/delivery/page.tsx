import { requireManager } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

// Placeholder. The lane that owns this route replaces the body.
// Keep the guard as the first line: the page is async and reads the session,
// which is fine because the (shell) layout renders it inside <Suspense>.
export default async function DeliveryPage() {
  await requireManager();

  return (
    <>
      <PageHeader title="Delivery" description="Snap the delivery docket and check it against the order." />
      <Card>
        <p className="text-sm text-muted">Docket photo upload, AI extraction and stock update go here.</p>
      </Card>
    </>
  );
}
