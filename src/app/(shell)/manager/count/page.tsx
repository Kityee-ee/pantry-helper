import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import type { Item } from "@/lib/types";
import { CountForm } from "./CountForm";

export default async function CountPage() {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select("id, name, unit, par_level, current_qty")
    .eq("active", true)
    .order("name");
  const items = (data ?? []) as Pick<Item, "id" | "name" | "unit" | "par_level" | "current_qty">[];

  return (
    <>
      <PageHeader
        title="Stock count"
        description="Count what is on the shelves. Only change the numbers that are wrong, then save."
      />
      {error ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Could not load the items: {error.message}
        </p>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No active items to count.</p>
        </Card>
      ) : (
        <CountForm items={items} />
      )}
    </>
  );
}
