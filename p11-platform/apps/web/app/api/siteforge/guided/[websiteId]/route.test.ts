import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  authGetUserMock,
  validatePropertyAccessMock,
  snapshotMock,
  conversationMock,
  prepareMock,
  confirmMock,
  generateMock,
  websiteMaybeSingleMock,
  profileMaybeSingleMock,
} = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  snapshotMock: vi.fn(),
  conversationMock: vi.fn(),
  prepareMock: vi.fn(),
  confirmMock: vi.fn(),
  generateMock: vi.fn(),
  websiteMaybeSingleMock: vi.fn(),
  profileMaybeSingleMock: vi.fn(),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUserMock },
  })),
}));

vi.mock("@/utils/services/auth-guard", () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}));

vi.mock("@/utils/supabase/admin", () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      const maybeSingle =
        table === "profiles" ? profileMaybeSingleMock : websiteMaybeSingleMock;
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = maybeSingle;
      return chain;
    },
  })),
}));

vi.mock("@/utils/siteforge/guided/service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/utils/siteforge/guided/service")>();
  return {
    ...actual,
    siteForgeGuidedService: vi.fn(() => ({
      snapshot: snapshotMock,
      conversation: conversationMock,
      prepare: prepareMock,
      confirm: confirmMock,
    })),
  };
});

vi.mock("@/app/api/siteforge/generate/route", () => ({
  POST: generateMock,
}));

import { GET as getSnapshot } from "./snapshot/route";
import { POST as postConversation } from "./conversation/route";
import { POST as postPrepare } from "./prepare/route";
import { POST as postConfirm } from "./confirm/route";
import { SiteForgeGuidedError } from "@/utils/siteforge/guided/service";

const websiteId = "11111111-1111-4111-8111-111111111111";
const propertyId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const routeContext = { params: Promise.resolve({ websiteId }) };

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const snapshotResult = {
  state: { websiteId },
  question: { field: "objective", question: "What should the site do?" },
  journey: { stage: "conversation" },
  attachmentRoutes: {
    images: "/api/siteforge/assets",
    floorPlans: "/api/siteforge/floor-plans/import/preview",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  authGetUserMock.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  websiteMaybeSingleMock.mockResolvedValue({
    data: { property_id: propertyId },
    error: null,
  });
  profileMaybeSingleMock.mockResolvedValue({
    data: { role: "manager" },
    error: null,
  });
  validatePropertyAccessMock.mockResolvedValue({ authorized: true });
  snapshotMock.mockResolvedValue(snapshotResult);
  conversationMock.mockResolvedValue({
    ...snapshotResult,
    duplicate: false,
    routedAttachments: [],
  });
  prepareMock.mockResolvedValue({
    ...snapshotResult,
    duplicate: false,
    scoredDirections: [],
  });
  confirmMock.mockResolvedValue({
    ...snapshotResult,
    duplicate: false,
  });
  generateMock.mockResolvedValue(
    NextResponse.json({ jobId: "job-1", status: "queued" }),
  );
});

describe("SiteForge guided routes", () => {
  it("requires authentication and tenant access before resuming a snapshot", async () => {
    authGetUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: new Error("missing"),
    });
    const unauthorized = await getSnapshot(
      request(`/api/siteforge/guided/${websiteId}/snapshot`),
      routeContext,
    );
    expect(unauthorized.status).toBe(401);

    validatePropertyAccessMock.mockResolvedValueOnce({ authorized: false });
    const forbidden = await getSnapshot(
      request(`/api/siteforge/guided/${websiteId}/snapshot`),
      routeContext,
    );
    expect(forbidden.status).toBe(403);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it("returns the durable resume projection without caching", async () => {
    const response = await getSnapshot(
      request(`/api/siteforge/guided/${websiteId}/snapshot`),
      routeContext,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      journey: { stage: "conversation" },
      question: { field: "objective" },
    });
  });

  it("returns duplicate conversation results and routes visual metadata separately", async () => {
    conversationMock.mockResolvedValueOnce({
      ...snapshotResult,
      duplicate: true,
      routedAttachments: [
        {
          route: "/api/siteforge/assets",
          attachment: { kind: "image", name: "hero.jpg" },
        },
      ],
    });
    const response = await postConversation(
      request(`/api/siteforge/guided/${websiteId}/conversation`, {
        clientRequestId: "turn-1",
        expectedRevision: 3,
        answer: "Increase tour bookings",
        attachments: [{ kind: "image", name: "hero.jpg" }],
      }),
      routeContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      duplicate: true,
      routedAttachments: [{ route: "/api/siteforge/assets" }],
    });
    expect(conversationMock).toHaveBeenCalledWith(
      websiteId,
      expect.objectContaining({ expectedRevision: 3 }),
    );
  });

  it("returns a plain Fair Housing correction instead of technical details", async () => {
    conversationMock.mockRejectedValueOnce(
      new SiteForgeGuidedError(
        "Please describe practical housing needs without targeting or excluding protected groups.",
        400,
        "needs_attention",
        false,
      ),
    );
    const response = await postConversation(
      request(`/api/siteforge/guided/${websiteId}/conversation`, {
        clientRequestId: "turn-unsafe",
        expectedRevision: 0,
        field: "renterNeeds",
        answer: "Perfect for families",
      }),
      routeContext,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Please describe practical housing needs without targeting or excluding protected groups.",
      classification: "needs_attention",
      retryable: false,
    });
  });

  it("preserves duplicate prepare and classifies stale and retryable failures", async () => {
    prepareMock.mockResolvedValueOnce({ ...snapshotResult, duplicate: true });
    const duplicate = await postPrepare(
      request(`/api/siteforge/guided/${websiteId}/prepare`, {
        idempotencyKey: "prepare-request-1",
      }),
      routeContext,
    );
    expect(await duplicate.json()).toMatchObject({ duplicate: true });

    prepareMock.mockRejectedValueOnce(
      new SiteForgeGuidedError(
        "Property or brand information changed.",
        409,
        "source_changed",
        false,
      ),
    );
    const stale = await postPrepare(
      request(`/api/siteforge/guided/${websiteId}/prepare`, {
        idempotencyKey: "prepare-request-2",
      }),
      routeContext,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      classification: "source_changed",
      retryable: false,
    });

    prepareMock.mockRejectedValueOnce(
      new SiteForgeGuidedError(
        "SiteForge could not finish that step right now. Your work is saved.",
        503,
        "temporary",
        true,
      ),
    );
    const retry = await postPrepare(
      request(`/api/siteforge/guided/${websiteId}/prepare`, {
        idempotencyKey: "prepare-request-2",
      }),
      routeContext,
    );
    expect(retry.status).toBe(503);
    expect(await retry.json()).toMatchObject({
      classification: "temporary",
      retryable: true,
    });
  });

  it("requires an elevated reviewer and delegates one resumable confirmation", async () => {
    profileMaybeSingleMock.mockResolvedValueOnce({
      data: { role: "member" },
      error: null,
    });
    const forbidden = await postConfirm(
      request(`/api/siteforge/guided/${websiteId}/confirm`, {
        idempotencyKey: "confirm-request-1",
        expected: {
          briefContentHash: "a".repeat(64),
          directionSetContentHash: "b".repeat(64),
          planContentHash: "c".repeat(64),
        },
      }),
      routeContext,
    );
    expect(forbidden.status).toBe(403);
    expect(confirmMock).not.toHaveBeenCalled();

    const response = await postConfirm(
      request(`/api/siteforge/guided/${websiteId}/confirm`, {
        idempotencyKey: "confirm-request-1",
        expected: {
          briefContentHash: "a".repeat(64),
          directionSetContentHash: "b".repeat(64),
          planContentHash: "c".repeat(64),
        },
      }),
      routeContext,
    );
    expect(response.status).toBe(200);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ duplicate: false });
  });
});
