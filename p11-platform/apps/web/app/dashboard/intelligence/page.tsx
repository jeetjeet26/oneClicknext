import { IntelligenceWorkspace } from "@/components/intelligence/IntelligenceWorkspace";
import { redirect } from "next/navigation";
import type { PerformanceSection } from "@/components/intelligence/ReviewedRecordsWorkspace";
export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  if (section === "facts") redirect("/dashboard/community?section=facts");
  if (section === "creative") redirect("/dashboard/siteforge/direction");
  const selected: PerformanceSection = section === "campaigns" || section === "sources" || section === "decisions" || section === "experiments" ? section : "insights";
  return <IntelligenceWorkspace section={selected} />;
}
