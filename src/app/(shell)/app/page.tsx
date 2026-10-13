import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TellUs } from "./TellUs";

export default async function TellUsPage() {
  await requireUser();

  // Shown in the copy ("Priya has been notified"). Names are readable by every signed-in user.
  const supabase = await createClient();
  const { data: manager } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("role", "manager")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const managerName = manager?.full_name?.split(" ")[0] || "The office manager";

  return (
    <>
      <PageHeader
        title="Tell us"
        description="Running low on something, want something new, or is something broken? Tell us in your own words."
      />
      <TellUs managerName={managerName} />
    </>
  );
}
