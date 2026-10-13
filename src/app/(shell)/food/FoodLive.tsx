"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const REFRESH_MS = 60_000;

/**
 * Keeps the board current without a reload: re-renders when a post is added or
 * claimed (Supabase Realtime), and once a minute so expired posts drop off.
 */
export function FoodLive() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => router.refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const channel = supabase
      .channel("food_posts")
      .on("postgres_changes", { event: "*", schema: "public", table: "food_posts" }, refresh)
      .subscribe();

    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
