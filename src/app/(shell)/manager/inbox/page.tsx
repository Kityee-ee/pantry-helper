import { requireManager } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

// Placeholder. The lane that owns this route replaces the body.
// Keep the guard as the first line: the page is async and reads the session,
// which is fine because the (shell) layout renders it inside <Suspense>.
export default async function InboxPage() {
  await requireManager();

  return (
    <>
      <PageHeader title="Inbox" description="What the team has told you, grouped and ready to action." />
      <Card>
        <p className="text-sm text-muted">Submissions inbox (acknowledge, resolve, add a note) goes here.</p>
      </Card>
    </>
  );
}
