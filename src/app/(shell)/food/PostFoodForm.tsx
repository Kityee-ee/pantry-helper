"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Button, Card, CardTitle } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { STORAGE_BUCKETS } from "@/lib/types";
import { postFoodAction } from "./actions";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const inputClass =
  "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

export function PostFoodForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const photo = form.get("photo");
    setError(null);

    startTransition(async () => {
      let photoPath: string | null = null;
      if (photo instanceof File && photo.size > 0) {
        const ext = PHOTO_TYPES[photo.type];
        if (!ext || photo.size > MAX_PHOTO_BYTES) {
          setError("Photos need to be a JPG, PNG or WebP under 5 MB.");
          return;
        }
        // Uploaded straight from the browser as the signed-in user, into their own folder.
        photoPath = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await createClient()
          .storage.from(STORAGE_BUCKETS.food)
          .upload(photoPath, photo, { contentType: photo.type });
        if (uploadError) {
          setError("The photo did not upload. Try again, or post without it.");
          return;
        }
      }

      const res = await postFoodAction({
        description: String(form.get("description") ?? ""),
        location: String(form.get("location") ?? ""),
        hours: Number(form.get("hours")) as 1 | 2 | 4,
        photoPath,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
      setOpen(false);
    });
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Share food</Button>;
  }

  return (
    <Card className="w-full">
      <CardTitle>Share food</CardTitle>
      <form ref={formRef} onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-muted">
          What is it?
          <input name="description" required maxLength={80} placeholder="e.g. Leftover sandwiches" className={inputClass} />
        </label>
        <label className="text-xs font-medium text-muted">
          Where?
          <input name="location" required maxLength={80} placeholder="e.g. Level 3 kitchen" className={inputClass} />
        </label>
        <label className="text-xs font-medium text-muted">
          Good for
          <select name="hours" defaultValue="2" className={inputClass}>
            <option value="1">1 hour</option>
            <option value="2">2 hours</option>
            <option value="4">4 hours</option>
          </select>
        </label>
        <label className="text-xs font-medium text-muted">
          Photo (optional)
          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className={`${inputClass} py-1.5`} />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Posting…" : "Post"}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
