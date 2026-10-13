import { requireManager } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

// Placeholder. The lane that owns this route replaces the body.
// Keep the guard as the first line: the page is async and reads the session,
// which is fine because the (shell) layout renders it inside <Suspense>.
export default async function CountPage() {
  await requireManager();

  return (
    <>
      <PageHeader title="Stock count" description="Count what is on the shelves." />
      <Card>
        <p className="text-sm text-muted">Stock count form goes here.</p>
      </Card>
    </>
  );
}
