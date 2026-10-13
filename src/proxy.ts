import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

// Next.js 16: this file used to be called middleware.ts. It is now proxy.ts
// and exports `proxy`. It does two things on every matched request:
//
//   1. Refreshes the Supabase session cookie (Server Components cannot write
//      cookies, so this is the only place an expired access token gets renewed).
//   2. Optimistic redirects, so the common cases are real HTTP redirects rather
//      than a streamed client-side one: signed-out -> /login, employee -> away
//      from /manager.
//
// The role used here comes from the JWT and is only a hint. The authoritative
// checks are requireUser() / requireManager() in src/lib/auth.ts plus RLS.

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not run code between createServerClient and getClaims: this call is what refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const signedIn = Boolean(claims?.sub);
  // app_metadata is set by the service role only (scripts/seed.ts); users cannot edit it.
  const roleHint = (claims?.app_metadata as { role?: string } | undefined)?.role;

  const { pathname } = request.nextUrl;

  const redirectTo = (path: string) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = "";
    const redirect = NextResponse.redirect(target);
    // Carry over any refreshed session cookies.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  // Route handlers authorise themselves (requireUser / CRON_SECRET) and should not be bounced to an HTML page.
  if (pathname.startsWith("/api")) return response;

  // A signed-in user may still open /login (no redirect), which avoids a loop if their profile row is missing.
  if (!signedIn) {
    return pathname === "/login" ? response : redirectTo("/login");
  }

  if (pathname === "/" && roleHint === "manager") return redirectTo("/manager");
  if (pathname === "/" && roleHint === "employee") return redirectTo("/app");
  if (pathname.startsWith("/manager") && roleHint === "employee") return redirectTo("/app");

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
