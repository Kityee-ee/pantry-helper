import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { requireUser, homeFor } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { NAV } from "@/components/shell/nav";
import { BottomNav, TopNav } from "@/components/shell/NavLinks";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { PageLoading } from "@/components/shell/PageLoading";

// App shell for every signed-in route: /app, /food, /manager.
//
// Cache Components pattern (cacheComponents: true in next.config.ts):
// the layout itself is synchronous and static. Anything that reads the session
// (cookies) lives in an async component INSIDE a <Suspense> boundary. A session
// read outside a boundary is a build error.
//
// Because {children} is rendered inside the <Suspense> below, pages under this
// layout may simply be `async` and `await requireUser()` / fetch per-user data
// at the top. They do not need their own boundary (add more for finer streaming).
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<ChromeFallback />}>
        <Chrome />
      </Suspense>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:pb-10">
        <Suspense fallback={<PageLoading />}>
          <SignedIn>{children}</SignedIn>
        </Suspense>
      </main>
    </div>
  );
}

/** Layout-level guard. Pages and actions must still call requireUser()/requireManager() themselves. */
async function SignedIn({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}

const headerClass = "sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur";
const headerInnerClass = "mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4";

/** Header, nav and bell. Per-user, so it streams in behind the boundary above. */
async function Chrome() {
  const profile = await requireUser();
  const items = NAV[profile.role];
  const name = profile.full_name || profile.email || "Signed in";

  return (
    <>
      <header className={headerClass}>
        <div className={headerInnerClass}>
          <Link href={homeFor(profile.role)} className="mr-2 text-base font-semibold tracking-tight text-accent-strong">
            Pantry Helper
          </Link>
          <TopNav items={items} />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell userId={profile.id} />
            <span className="hidden max-w-40 truncate px-2 text-sm text-muted sm:block" title={profile.email ?? undefined}>
              {name}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="h-10 rounded-lg px-3 text-sm font-medium text-muted hover:bg-black/5 hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <BottomNav items={items} />
    </>
  );
}

function ChromeFallback() {
  return (
    <header className={headerClass}>
      <div className={headerInnerClass}>
        <span className="text-base font-semibold tracking-tight text-accent-strong">Pantry Helper</span>
      </div>
    </header>
  );
}
