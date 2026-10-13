import { Suspense, type ReactNode } from "react";
import { requireManager } from "@/lib/auth";
import { PageLoading } from "@/components/shell/PageLoading";

// Manager-only section. Employees are redirected to /app, signed-out users to /login.
// The boundary here (below the layout that /manager/* pages share) is what lets
// navigation between manager pages show a loading state instantly.
export default function ManagerLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ManagerOnly>{children}</ManagerOnly>
    </Suspense>
  );
}

/**
 * Layout-level guard. A layout cannot stop its children from rendering, and it
 * does not re-run on client navigation, so every manager page, server action
 * and route handler must ALSO call `await requireManager()` itself.
 */
async function ManagerOnly({ children }: { children: ReactNode }) {
  await requireManager();
  return children;
}
