import { requireManager } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { APP_TIME_ZONE } from "@/lib/week";
import { DeliveryFlow } from "./DeliveryFlow";
import { loadCatalogue, loadOpenOrder } from "./data";
import type { CatalogueEntry, OpenOrder } from "./shared";

export default async function DeliveryPage() {
  await requireManager();
  const supabase = await createClient();

  let catalogue: CatalogueEntry[] = [];
  let openOrder: OpenOrder | null = null;
  let lastDelivery: string | null = null;
  let loadError = false;
  try {
    [catalogue, openOrder] = await Promise.all([loadCatalogue(supabase), loadOpenOrder(supabase)]);
    const { data: latest } = await supabase
      .from("deliveries")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.created_at) {
      lastDelivery = new Intl.DateTimeFormat("en-AU", {
        timeZone: APP_TIME_ZONE,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(latest.created_at as string));
    }
  } catch (e) {
    console.error("[delivery] page load failed:", e instanceof Error ? e.message : e);
    loadError = true;
  }

  return (
    <>
      <PageHeader title="Delivery" description="Snap the delivery docket and check it against the order." />
      {loadError ? (
        <Card>
          <p className="text-sm text-danger">Stock and orders could not be loaded. Reload the page to try again.</p>
        </Card>
      ) : (
        <DeliveryFlow catalogue={catalogue} openOrder={openOrder} lastDelivery={lastDelivery} />
      )}
    </>
  );
}
