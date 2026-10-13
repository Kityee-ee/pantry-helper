import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { Badge, Card, PageHeader } from "@/components/ui";
import { STORAGE_BUCKETS, type FoodPost } from "@/lib/types";
import { ClaimButton } from "./ClaimButton";
import { FoodLive } from "./FoodLive";
import { PostFoodForm } from "./PostFoodForm";

function timeLeft(expiresAt: string, now: number): string {
  const mins = Math.max(1, Math.round((new Date(expiresAt).getTime() - now) / 60_000));
  if (mins < 60) return `${mins} min left`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
}

/** Unexpired posts, newest first. Expired posts are never deleted, just filtered out here. */
async function loadBoard() {
  const supabase = await createClient();
  const now = Date.now();

  const { data, error } = await supabase
    .from("food_posts")
    .select("*")
    .gt("expires_at", new Date(now).toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  const posts = ((data ?? []) as FoodPost[]).map((p) => ({ ...p, left: timeLeft(p.expires_at, now) }));

  const peopleIds = [...new Set(posts.flatMap((p) => [p.user_id, p.claimed_by]).filter((id): id is string => !!id))];
  const { data: people } = peopleIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", peopleIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string | null) || "A colleague"]));

  return { posts, names, failed: Boolean(error) };
}

export default async function FoodBoardPage() {
  const profile = await requireUser();
  const { posts, names, failed } = await loadBoard();

  const available = posts.filter((p) => !p.claimed_by);
  // Claimed posts stay visible only to the two people involved, until they expire.
  const gone = posts.filter((p) => p.claimed_by && (p.claimed_by === profile.id || p.user_id === profile.id));
  const photoBase = `${supabaseEnv().url}/storage/v1/object/public/${STORAGE_BUCKETS.food}/`;

  return (
    <>
      <FoodLive />
      <PageHeader title="Free food" description="Leftovers up for grabs. Post what is spare, claim what you want." />

      <div className="mb-5">
        <PostFoodForm userId={profile.id} />
      </div>

      {failed ? (
        <Card>
          <p className="text-sm text-danger">We could not load the board. Try refreshing the page.</p>
        </Card>
      ) : available.length === 0 && gone.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nothing going right now. You will get a notification when someone posts.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {[...available, ...gone].map((post) => {
            const mine = post.user_id === profile.id;
            const claimed = Boolean(post.claimed_by);
            return (
              <li key={post.id}>
                <Card className={`flex items-center gap-4 ${claimed ? "opacity-70" : ""}`}>
                  {post.photo_path ? (
                    // Plain <img>: the photo lives in Supabase Storage, outside next/image's configured hosts.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoBase + post.photo_path}
                      alt=""
                      className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{post.description}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {post.location} · from {mine ? "you" : names.get(post.user_id)}
                    </p>
                    <p className="mt-1 text-xs text-muted">{post.left}</p>
                  </div>
                  {claimed ? (
                    <Badge tone="accent">
                      {post.claimed_by === profile.id ? "You claimed this" : `Claimed by ${names.get(post.claimed_by!)}`}
                    </Badge>
                  ) : mine ? (
                    <Badge>Your post</Badge>
                  ) : (
                    <ClaimButton postId={post.id} />
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
