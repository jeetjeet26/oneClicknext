import { ClientProduct } from "@/components/client-portal/ClientProduct";
import { clientScope, portalActor } from "@/utils/client-portal/server";
import { visibleProducts } from "@/utils/client-portal/products";
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
      !["performance", "properties", "reports", "conversations", "marketvision", "reviewflow"].includes(
        section[0],
      ))
  )
    notFound();
  const actor = await portalActor();
  const scope = await clientScope(actor.id);
  const required = ["performance", "reports"].includes(section[0]) ? "reporting" : section[0] === "conversations" ? "lumaleasing" : section[0];
  if (required && required !== "properties" && !visibleProducts(scope).some(p => p === required)) notFound();
  if (section[0] === "marketvision" || section[0] === "reviewflow") return <ClientProduct actor={actor.id} product={section[0]} />;
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
