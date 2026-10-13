"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { notify, notifyAllExcept } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";

const POSTS_PER_HOUR = 5;

const Post = z.object({
  description: z.string().trim().min(1).max(80),
  location: z.string().trim().min(1).max(80),
  hours: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  photoPath: z.string().max(200).nullable(),
});

export type PostFoodInput = z.input<typeof Post>;
export type FoodActionResult = { ok: true } | { ok: false; error: string };

/** Post free food and bell everyone else. */
export async function postFoodAction(input: PostFoodInput): Promise<FoodActionResult> {
  const profile = await requireUser();

  const parsed = Post.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Say what it is and where it is (up to 80 characters each)." };
  const { description, location, hours, photoPath } = parsed.data;

  // The photo is uploaded from the browser, so the path is untrusted: only accept one in the poster's own folder.
  const ownPhoto = new RegExp(`^${profile.id}/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp)$`);
  if (photoPath && !ownPhoto.test(photoPath)) return { ok: false, error: "That photo could not be attached." };

  const supabase = await createClient();

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await supabase
    .from("food_posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .gt("created_at", hourAgo);
  if ((count ?? 0) >= POSTS_PER_HOUR) return { ok: false, error: "That is a lot of posts. Try again later." };

  const { error } = await supabase.from("food_posts").insert({
    user_id: profile.id,
    description,
    location,
    photo_path: photoPath,
    expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
  });
  if (error) {
    console.error("[food] post failed:", error.message);
    return { ok: false, error: "We could not post that. Please try again." };
  }

  await notifyAllExcept(profile.id, {
    title: `Free food: ${description}`,
    body: `${location} · from ${profile.full_name || "a colleague"} · up for ${hours}h`,
    link: "/food",
  });

  revalidatePath("/food");
  return { ok: true };
}

/** Claim a post. The first claim wins; everyone after gets ok: false. */
export async function claimFoodAction(rawId: string): Promise<FoodActionResult> {
  const profile = await requireUser();

  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { ok: false, error: "That post could not be found." };

  // One conditional UPDATE, so two people claiming at once cannot both succeed.
  // RLS also only lets an employee update a post that is unclaimed and unexpired.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("food_posts")
    .update({ claimed_by: profile.id, claimed_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("claimed_by", null)
    .gt("expires_at", new Date().toISOString())
    .neq("user_id", profile.id)
    .select("user_id, description");

  revalidatePath("/food");

  if (error) {
    console.error("[food] claim failed:", error.message);
    return { ok: false, error: "We could not claim that. Please try again." };
  }
  if (!data || data.length === 0) return { ok: false, error: "Too late, it has just gone." };

  const post = data[0];
  await notify([post.user_id as string], {
    title: `${profile.full_name || "Someone"} claimed your ${post.description}`,
    link: "/food",
  });

  return { ok: true };
}
