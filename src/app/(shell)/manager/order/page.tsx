import { requireManager } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

// Placeholder. The lane that owns this route replaces the body.
// Keep the guard as the first line: the page is async and reads the session,
// which is fine because the (shell) layout renders it inside <Suspense>.
export default async function OrderPage() {
  await requireManager();

  return (
    <>
      <PageHeader title="Weekly order" description="Build next week's order from stock, headcount and requests." />
      <Card>
        <p className="text-sm text-muted">Order list and the AI-suggested draft for next week go here.</p>
      </Card>
    </>
  );
}
