import { notFound } from "next/navigation";
import { visibleProducts } from "@/utils/client-portal/products";
import { Suspense } from "react";
import {
  portalActor,
  clientScope,
  clientLumaProperties,
} from "@/utils/client-portal/server";
import { ClientInsights } from "@/components/intelligence/ClientInsights";
export default async function Page() {
  const actor = await portalActor();
  const scope = await clientScope(actor.id);
  if (!visibleProducts(scope).includes("reporting")) notFound();
  const luma = await clientLumaProperties(scope);
  return (
    <Suspense fallback={<p role="status" className="p-6">Loading results…</p>}><ClientInsights products={visibleProducts(scope)} name={scope.name} properties={scope.properties} hasConversations={luma.length > 0} /></Suspense>
  );
}
