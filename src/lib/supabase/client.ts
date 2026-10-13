"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Browser Supabase client (a singleton under the hood). Runs as the signed-in user, RLS applies.
 * Use for realtime subscriptions, storage uploads and light client-side reads.
 */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
