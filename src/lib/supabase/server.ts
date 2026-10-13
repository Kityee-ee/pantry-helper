import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabaseEnv } from "./env";

/**
 * Cookie-based Supabase client for Server Components, Server Actions and Route Handlers.
 * Runs as the signed-in user, so RLS applies. Create a new one per request; never share.
 *
 * Reads cookies, so under Cache Components it must be called at request time:
 * inside a <Suspense> boundary when rendering, or in an action / route handler.
 */
export async function createClient() {
  // Supabase auth reads the clock while loading the session, so mark this as request-time work first.
  await connection();
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. Safe to ignore:
          // src/proxy.ts refreshes the session cookie on every request.
        }
      },
    },
  });
}
