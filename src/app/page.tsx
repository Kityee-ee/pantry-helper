import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionProfile, homeFor } from "@/lib/auth";

// "/" only redirects: /manager or /app by role, /login when signed out.
// (src/proxy.ts usually does this first, from the JWT. This is the authoritative version.)
export default function Home() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
      <RoleRedirect />
    </Suspense>
  );
}

async function RoleRedirect(): Promise<never> {
  const profile = await getSessionProfile();
  redirect(profile ? homeFor(profile.role) : "/login");
}
