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
    <ClientInsights name={scope.name} hasConversations={luma.length > 0} />
  );
}
