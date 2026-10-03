import { createServiceClient } from "@/utils/supabase/admin";
import {
  clientScope,
  portalRpc,
  PortalError,
  clientLumaProperties,
} from "./server";
import type { PortalScope } from "./contracts";
import {
  visitorMessagePage,
  type ClientConversation,
  type ClientConversationsData,
  type clientConversationQuery,
} from "./conversation-contracts";
import type { z } from "zod";

const columns =
  "id,property_id,created_at,leads(property_id,first_name,last_name),messages(content,created_at)" as const;
export async function readClientConversations(
  actor: string,
  query: z.infer<typeof clientConversationQuery>,
): Promise<ClientConversationsData> {
  const scope = await clientScope(actor);
  if (
    query.propertyId &&
    !scope.properties.some((p) => p.id === query.propertyId)
  )
    throw new PortalError(
      "This property is not available to your account.",
      403,
    );
  const properties = await clientLumaProperties(scope);
  const eligible = properties.filter(
    (p) => !query.propertyId || p.id === query.propertyId,
  );
  const ids = eligible.map((p) => p.id);
  const db = createServiceClient();
  const result: ClientConversationsData = {
    name: scope.name,
    properties,
    conversations: [],
    nextOffset: null,
    selected: null,
    messages: [],
    nextBeforeId: null,
  };
  if (query.conversationId && !ids.length)
    throw new PortalError("This conversation is not available.", 404);
  if (ids.length) {
    // Restrict parents before reading related messages or names. Only the visible
    // user/assistant exchange is projected; no system messages or staff decisions.
    let request = db
      .from("conversations")
      .select(columns)
      .in("property_id", ids)
      .eq("channel", "widget")
      .in("leads.property_id", ids)
      .in("messages.role", ["user", "assistant"])
      .neq("messages.content", "")
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .order("created_at", {
        referencedTable: "messages",
        ascending: false,
        nullsFirst: false,
      })
      .order("id", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" });
    if (query.conversationId)
      request = request.eq("id", query.conversationId).limit(1);
    else {
      if (query.days !== "all") {
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        start.setUTCDate(start.getUTCDate() - (Number(query.days) - 1));
        request = request.gte("created_at", start.toISOString());
      }
      request = request.range(query.offset, query.offset + 25);
    }
    const { data, error } = await request;
    if (error || !data)
      throw new PortalError(
        "Conversations could not be loaded. Please try again.",
      );
    const rows: ClientConversation[] = data.map((c) => {
      const property = eligible.find((p) => p.id === c.property_id);
      if (!property)
        throw new PortalError("This conversation is not available.", 404);
      const lead = c.leads?.property_id === c.property_id ? c.leads : null;
      return {
        id: c.id,
        propertyId: property.id,
        propertyName: property.name,
        visitor:
          [lead?.first_name, lead?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || "Website visitor",
        createdAt: c.created_at,
        preview: c.messages[0]?.content?.slice(0, 180) ?? null,
      };
    });
    if (query.conversationId) {
      if (!rows[0])
        throw new PortalError("This conversation is not available.", 404);
      const page = visitorMessagePage.safeParse(
        await portalRpc("read_luma_visitor_messages", {
          p_property_id: rows[0].propertyId,
          p_conversation_id: rows[0].id,
          p_before_id: query.beforeId ?? null,
        }),
      );
      if (!page.success)
        throw new PortalError(
          "The conversation could not be loaded. Please refresh.",
        );
      result.selected = rows[0];
      result.messages = page.data.messages;
      result.nextBeforeId = page.data.nextBeforeId;
      // Recheck parent ownership after fetching the transcript as well as the
      // client's current assignment below, so a concurrent move fails closed.
      const check = await db
        .from("conversations")
        .select("id")
        .eq("id", rows[0].id)
        .eq("property_id", rows[0].propertyId)
        .eq("channel", "widget")
        .maybeSingle();
      if (check.error || !check.data)
        throw new PortalError("This conversation is not available.", 404);
    } else {
      result.conversations = rows.slice(0, 25);
      result.nextOffset = rows.length > 25 ? query.offset + 25 : null;
    }
  }
  await confirmScope(
    actor,
    scope,
    properties.map((p) => p.id),
  );
  return result;
}

async function confirmScope(
  actor: string,
  initial: PortalScope,
  chatbotIds: string[],
) {
  const latest = await clientScope(actor);
  if (
    latest.orgId !== initial.orgId ||
    latest.revision !== initial.revision ||
    JSON.stringify(latest.properties) !== JSON.stringify(initial.properties)
  )
    throw new PortalError(
      "Your property access changed. Refresh to see the latest view.",
      409,
    );
  const current = await clientLumaProperties(latest);
  if (JSON.stringify(current.map((p) => p.id)) !== JSON.stringify(chatbotIds))
    throw new PortalError(
      "Your available conversations changed. Please refresh.",
      409,
    );
}
