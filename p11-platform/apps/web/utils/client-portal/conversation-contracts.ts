import { z } from "zod";
import { id, type PortalProperty } from "./contracts";

export const clientConversationQuery = z
  .object({
    propertyId: id.optional(),
    days: z.enum(["7", "30", "90", "all"]).default("all"),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    conversationId: id.optional(),
    beforeId: id.optional(),
  })
  .strict()
  .refine((q) => !q.beforeId || !!q.conversationId, {
    message: "Choose a conversation before loading earlier messages.",
  });

export type ChatProperty = PortalProperty & { active: boolean };
export type ClientConversation = {
  id: string;
  propertyId: string;
  propertyName: string;
  visitor: string;
  createdAt: string | null;
  preview: string | null;
};
export const visitorMessagePage = z.object({
  messages: z.array(
    z.object({
      id,
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      createdAt: z.string().nullable(),
    }),
  ),
  nextBeforeId: id.nullable(),
});
export type ClientMessage = z.infer<
  typeof visitorMessagePage
>["messages"][number];
export type ClientConversationsData = {
  name: string;
  properties: ChatProperty[];
  conversations: ClientConversation[];
  nextOffset: number | null;
  selected: ClientConversation | null;
  messages: ClientMessage[];
  nextBeforeId: string | null;
};
