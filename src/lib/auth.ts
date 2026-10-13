import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/** Where each role lands after sign-in. */
export function homeFor(role: Role): "/manager" | "/app" {
  return role === "manager" ? "/manager" : "/app";
}

/**
 * The signed-in profile, or null when signed out.
 *
 * Reads the session cookie (request-time data), so when rendering it must run
 * inside a <Suspense> boundary. Deduplicated per request with React cache(),
 * so layouts, pages and components can all call it freely.
 */
export const getSessionProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();

  // getClaims() verifies the JWT (locally with asymmetric keys, otherwise via the Auth server).
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  // RLS-checked read: PostgREST validates the token again here.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .eq("id", userId)
    .maybeSingle();

  return (profile as Profile | null) ?? null;
});

/** Signed-in profile, or redirect to /login. Use in layouts, pages, actions and route handlers. */
export async function requireUser(): Promise<Profile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** Manager profile, or redirect (/login when signed out, /app for employees). */
export async function requireManager(): Promise<Profile> {
  const profile = await requireUser();
  if (profile.role !== "manager") redirect("/app");
  return profile;
}
