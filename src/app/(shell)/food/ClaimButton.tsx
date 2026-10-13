"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { claimFoodAction } from "./actions";

export function ClaimButton({ postId }: { postId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function claim() {
    setError(null);
    startTransition(async () => {
      const res = await claimFoodAction(postId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={claim} disabled={pending}>
        {pending ? "Claiming…" : "Claim"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
