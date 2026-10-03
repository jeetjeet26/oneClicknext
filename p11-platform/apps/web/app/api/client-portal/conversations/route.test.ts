import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn() }));
vi.mock("@/utils/client-portal/server", async () => ({
  portalActor: m.actor,
  PortalError: (await import("@/utils/knowledge/inventory")).InventoryError,
}));
vi.mock("@/utils/client-portal/conversations", () => ({
  readClientConversations: m.read,
}));
import { GET } from "./route";
import { clientApiAllowed } from "@/utils/client-portal/routing";
import { InventoryError } from "@/utils/knowledge/inventory";
const actor = "ed610001-0000-4000-8000-000000000001";
const req = (query = "") =>
  new Request("http://localhost/api/client-portal/conversations" + query);
beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue({ id: actor });
  m.read.mockResolvedValue({ conversations: [] });
});
describe("read-only client conversations endpoint", () => {
  it("uses the authenticated actor and prevents caching", async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.read).toHaveBeenCalledWith(actor, { days: "all", offset: 0 });
  });
  it.each([
    "?actorId=" + actor,
    "?propertyId=wrong",
    "?offset=-1",
    "?offset=100001",
    "?days=365",
    "?beforeId=" + actor,
  ])("rejects invalid filters or supplied identity %s", async (query) => {
    expect((await GET(req(query))).status).toBe(400);
    expect(m.read).not.toHaveBeenCalled();
  });
  it("requires a signed-in account", async () => {
    m.actor.mockRejectedValue(new InventoryError("Please sign in.", 401));
    expect((await GET(req())).status).toBe(401);
    expect(m.read).not.toHaveBeenCalled();
  });
  it("returns revoked-access status and no transcript", async () => {
    m.read.mockRejectedValue(new InventoryError("Access removed.", 403));
    const response = await GET(req());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Access removed." });
  });
  it("allows only read requests through the client API boundary", () => {
    expect(clientApiAllowed("/api/client-portal/conversations", "GET")).toBe(
      true,
    );
    expect(clientApiAllowed("/api/client-portal/conversations", "HEAD")).toBe(
      true,
    );
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(clientApiAllowed("/api/client-portal/conversations", method)).toBe(
        false,
      );
    expect(
      clientApiAllowed("/api/lumaleasing/admin/conversation-work", "POST"),
    ).toBe(false);
  });
});
