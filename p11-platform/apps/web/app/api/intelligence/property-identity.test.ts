import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { commandSchema } from "@/utils/intelligence/contracts";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  documents: vi.fn(),
  portfolio: vi.fn(),
}));
vi.mock("@/utils/team/http", () => ({ requireTeamOrigin: vi.fn(), teamBody: vi.fn() }));
vi.mock("@/utils/knowledge/inventory", () => ({ InventoryError: class extends Error {} }));
vi.mock("@/utils/supabase/admin", () => ({
  createServiceClient: () => ({ from: () => {
    const query = { select: () => query, eq: () => query, in: () => query,
      order: () => query, limit: async () => ({ data: [], error: null }) };
    return query;
  } }),
}));
vi.mock("@/utils/intelligence/store", async () => {
  const { createServiceClient } = await import("@/utils/supabase/admin");
  return {
    intelligenceActor: mocks.actor, readDocuments: mocks.documents,
    intelligenceDb: createServiceClient, saveDocument: vi.fn(), canonicalInformation: vi.fn(),
    IntelligenceError: class extends Error { constructor(message: string, readonly status = 503) { super(message); } },
  };
});
vi.mock("@/utils/intelligence/providers", () => ({
  connectionSummary: () => [], enabledProviders: ["reviewed_import"],
  providerBinding: vi.fn(), retrieveProvider: vi.fn(),
}));
vi.mock("@/utils/intelligence/portfolio", () => ({ readPortfolio: mocks.portfolio }));
import { GET } from "./route";

const propertyId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
describe("intelligence property identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue("actor");
    mocks.documents.mockResolvedValue([]);
  });

  it("loads facts for existing database IDs without requiring RFC version bits", async () => {
    const response = await GET(new NextRequest(`https://example.com/api/intelligence?propertyId=${propertyId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ documents: [], canManage: true });
    expect(mocks.actor).toHaveBeenCalledWith(propertyId);
    expect(mocks.documents).toHaveBeenCalledWith(propertyId);
  });

  it("accepts the same property ID when saving facts", () => {
    expect(commandSchema.safeParse({
      propertyId, requestId: "12345678-1234-4234-8234-123456789012",
      kind: "fact", key: "short_description", expectedRevision: 0,
      operation: "save", reason: "Update reviewed facts", payload: {},
    }).success).toBe(true);
  });

  it("rejects malformed property IDs without blaming fact dates", async () => {
    const response = await GET(new NextRequest("https://example.com/api/intelligence?propertyId=invalid"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Choose a valid property to load its records." });
    expect(mocks.actor).not.toHaveBeenCalled();
  });

  it("still checks property access before reading facts", async () => {
    const { IntelligenceError } = await import("@/utils/intelligence/store");
    mocks.actor.mockRejectedValue(new IntelligenceError("Property access denied.", 403));
    const response = await GET(new NextRequest(`https://example.com/api/intelligence?propertyId=${propertyId}`));
    expect(response.status).toBe(403);
    expect(mocks.documents).not.toHaveBeenCalled();
  });

  it("still rejects reversed portfolio dates", async () => {
    const response = await GET(new NextRequest(`https://example.com/api/intelligence?kind=portfolio&propertyId=${propertyId}&start=2026-11-03&end=2026-11-01`));
    expect(response.status).toBe(400);
    expect(mocks.portfolio).not.toHaveBeenCalled();
  });
});
