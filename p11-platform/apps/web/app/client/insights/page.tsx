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
  const luma = await clientLumaProperties(scope);
  return (
    <Suspense fallback={<p role="status" className="p-6">Loading results…</p>}><ClientInsights name={scope.name} properties={scope.properties} hasConversations={luma.length > 0} /></Suspense>
  );
}
