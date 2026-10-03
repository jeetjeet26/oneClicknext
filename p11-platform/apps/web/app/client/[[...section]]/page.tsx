import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ClientPortal } from "@/components/client-portal/ClientPortal";
import { ClientConversations } from "@/components/client-portal/ClientConversations";
export default async function ClientPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  if (
    section.length > 1 ||
    (section.length === 1 &&
      !["performance", "properties", "reports", "conversations"].includes(
        section[0],
      ))
  )
    notFound();
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-slate-50 p-10 text-sm text-slate-500">
          Loading your workspace…
        </div>
      }
    >
      {section[0] === "conversations" ? (
        <ClientConversations />
      ) : (
        <ClientPortal view={section[0] ?? "overview"} />
      )}
    </Suspense>
  );
}
