import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  scope: vi.fn(),
  properties: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("./server", async () => ({
  clientScope: m.scope,
  clientLumaProperties: m.properties,
  portalRpc: m.rpc,
  PortalError: (await import("@/utils/knowledge/inventory")).InventoryError,
}));
vi.mock("@/utils/supabase/admin", () => ({
  createServiceClient: () => ({ from: m.from }),
}));
import { readClientConversations } from "./conversations";
import { clientConversationQuery } from "./conversation-contracts";
const actor = "ed610001-0000-4000-8000-000000000001",
  property = "ed610001-0000-4000-8000-000000000002",
  hidden = "ed610001-0000-4000-8000-000000000003",
  conversation = "ed610001-0000-4000-8000-000000000004";
const p = { id: property, name: "Harbor House", address: {}, active: false };
const scope = {
  state: "ready",
  orgId: actor,
  revision: 1,
  properties: [p],
  name: "Client",
};
const row = {
  id: conversation,
  property_id: property,
  created_at: "2026-10-01T12:00:00Z",
  leads: {
    property_id: property,
    first_name: "Taylor",
    last_name: "Visitor",
    email: "private@invalid.test",
  },
  messages: [
    { content: "A two-bedroom home", created_at: "2026-10-01T12:01:00Z" },
  ],
  widget_session_id: "PRIVATE SESSION",
};
const query = (v: Record<string, unknown> = {}) =>
  clientConversationQuery.parse(v);
function response(data: unknown, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [
    "select",
    "in",
    "eq",
    "neq",
    "order",
    "limit",
    "range",
    "gte",
    "maybeSingle",
  ])
    chain[name] = vi.fn(() => chain);
  chain.then = vi.fn((resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve),
  );
  m.from.mockReturnValueOnce(chain);
  return chain;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.scope.mockResolvedValue(scope);
  m.properties.mockResolvedValue([p]);
  m.rpc.mockResolvedValue({
    state: "ready",
    messages: [{ id: actor, role: "user", content: "Hello", createdAt: null }],
    nextBeforeId: null,
    privateNotes: "INTERNAL",
  });
});
describe("client transcript boundary", () => {
  it("rejects a property outside the current assignment before reading chats", async () => {
    await expect(
      readClientConversations(actor, query({ propertyId: hidden })),
    ).rejects.toMatchObject({ status: 403 });
    expect(m.from).not.toHaveBeenCalled();
  });
  it("shows paused chatbot history and projects only intended fields", async () => {
    const request = response([row]);
    const result = await readClientConversations(actor, query());
    expect(request.in).toHaveBeenCalledWith("property_id", [property]);
    expect(request.eq).toHaveBeenCalledWith("channel", "widget");
    expect(request.in).toHaveBeenCalledWith("messages.role", [
      "user",
      "assistant",
    ]);
    expect(request.limit).toHaveBeenCalledWith(1, {
      referencedTable: "messages",
    });
    expect(result.conversations[0].visitor).toBe("Taylor Visitor");
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private@/);
  });
  it("does not expose a name linked from another property", async () => {
    response([{ ...row, leads: { ...row.leads, property_id: hidden } }]);
    expect(
      (await readClientConversations(actor, query())).conversations[0].visitor,
    ).toBe("Website visitor");
  });
  it("uses a bounded page and separate has-more row", async () => {
    const request = response(Array.from({ length: 26 }, () => row));
    const result = await readClientConversations(
      actor,
      query({ offset: 25, days: "7" }),
    );
    expect(request.range).toHaveBeenCalledWith(25, 50);
    expect(request.gte).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(result.conversations).toHaveLength(25);
    expect(result.nextOffset).toBe(50);
  });
  it("does not query conversations when no assigned property has a chatbot", async () => {
    m.properties.mockResolvedValue([]);
    expect((await readClientConversations(actor, query())).properties).toEqual(
      [],
    );
    expect(m.from).not.toHaveBeenCalled();
  });
  it("refuses a guessed conversation and never reads its messages", async () => {
    response([]);
    await expect(
      readClientConversations(actor, query({ conversationId: hidden })),
    ).rejects.toMatchObject({ status: 404 });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("loads earlier messages with the verified property and excludes RPC metadata", async () => {
    response([row]);
    response({ id: conversation });
    const result = await readClientConversations(
      actor,
      query({ conversationId: conversation, beforeId: actor }),
    );
    expect(m.rpc).toHaveBeenCalledWith("read_luma_visitor_messages", {
      p_property_id: property,
      p_conversation_id: conversation,
      p_before_id: actor,
    });
    expect(result.messages).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("INTERNAL");
  });
  it("discards a transcript if its parent is moved while loading", async () => {
    response([row]);
    response(null);
    await expect(
      readClientConversations(actor, query({ conversationId: conversation })),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("discards data if property access changes during the read", async () => {
    response([row]);
    m.scope
      .mockResolvedValueOnce(scope)
      .mockResolvedValueOnce({ ...scope, revision: 2 });
    await expect(readClientConversations(actor, query())).rejects.toMatchObject(
      { status: 409 },
    );
  });
  it("discards data if the chatbot is removed during the read", async () => {
    response([row]);
    m.properties.mockResolvedValueOnce([p]).mockResolvedValueOnce([]);
    await expect(readClientConversations(actor, query())).rejects.toMatchObject(
      { status: 409 },
    );
  });
  it("fails closed on database or unexpected message-role errors", async () => {
    response(null, new Error("Database unavailable"));
    await expect(readClientConversations(actor, query())).rejects.toThrow(
      "could not be loaded",
    );
    response([row]);
    m.rpc.mockResolvedValue({
      messages: [
        { id: actor, role: "system", content: "SECRET", createdAt: null },
      ],
      nextBeforeId: null,
    });
    await expect(
      readClientConversations(actor, query({ conversationId: conversation })),
    ).rejects.toThrow("could not be loaded");
  });
});
