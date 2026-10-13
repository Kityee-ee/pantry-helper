import { requireManager } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

// Placeholder. The lane that owns this route replaces the body.
// Keep the guard as the first line: the page is async and reads the session,
// which is fine because the (shell) layout renders it inside <Suspense>.
export default async function ManagerDashboardPage() {
  await requireManager();

  return (
    <>
      <PageHeader title="Dashboard" description="Stock at a glance and what needs your attention this week." />
      <Card>
        <p className="text-sm text-muted">Stock levels, low-stock alerts and weekly summary go here.</p>
      </Card>
    </>
  );
}
