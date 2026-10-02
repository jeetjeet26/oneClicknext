import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock("@/utils/delivery/server", async () => {
  const { InventoryError } = await import("@/utils/knowledge/inventory");
  return {
    deliveryActor: m.actor,
    deliveryRpc: m.rpc,
    DeliveryError: InventoryError,
  };
});
import { GET, POST } from "./route";
const id = "ed610001-0000-4000-8000-000000000021",
  other = "ed610001-0000-4000-8000-000000000022";
const body = {
  requestId: id,
  expectedActorId: id,
  propertyId: id,
  input: { operation: "report_draft", month: "2026-09" },
};
const req = (b: unknown = body, origin = "http://localhost") =>
  new Request("http://localhost/api/delivery", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(b),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue({ id });
  m.rpc.mockResolvedValue({ state: "saved", id, propertyId: id });
});
describe("delivery API boundary", () => {
  it("passes only the verified session actor", async () => {
    expect((await POST(req())).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("decide_delivery", {
      p_id: id,
      p_actor_id: id,
      p_property_id: id,
      p_input: body.input,
    });
  });
  it("rejects foreign origins before an action", async () => {
    expect((await POST(req(body, "https://other.test"))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rejects account changes", async () => {
    m.actor.mockResolvedValue({ id: other });
    expect((await POST(req())).status).toBe(409);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {
      operation: "work_save",
      targetId: null,
      revision: null,
      title: "Review website",
      product: "siteforge",
      playbook: "custom",
      ownerId: id,
      dueOn: "2026-10-09",
      nextStep: "Review in Basecamp",
      proposal: "",
      clientSummary: "",
      baselineEvent: null,
    },
    {
      operation: "work_transition",
      targetId: id,
      revision: 1,
      status: "review",
      nextStep: "Review in Basecamp",
      evidenceId: null,
    },
    {
      operation: "quality_review",
      targetId: id,
      revision: 1,
      evidenceId: other,
      assessment: {
        model: "Staff review",
        factual: true,
        brand: true,
        complete: true,
        score: 4,
        corrections: "Reviewed the saved work",
        baselineMinutes: null,
        deliveryMinutes: null,
        reviewMinutes: null,
        correctionMinutes: null,
        costUsd: null,
      },
    },
  ])("retires $operation without changing stored work", async (input) => {
    const response = await POST(req({ ...body, input }));
    expect(response.status).toBe(410);
    expect((await response.json()).error).toContain("Basecamp");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("still closes unresolved requests from older work forms", async () => {
    const input = { operation: "cancel_request" };
    expect((await POST(req({ ...body, input }))).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("decide_delivery", {
      p_id: id,
      p_actor_id: id,
      p_property_id: id,
      p_input: input,
    });
  });
  it("rejects unrecognized command fields and oversized input", async () => {
    expect(
      (await POST(req({ ...body, input: { ...body.input, publish: true } })))
        .status,
    ).toBe(400);
    expect((await POST(req({ data: "x".repeat(131073) }))).status).toBe(413);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("supports same-request recovery with private responses", async () => {
    const r = await GET(
      new Request(
        `http://localhost/api/delivery?propertyId=${id}&receiptId=${id}`,
      ),
    );
    expect(m.rpc).toHaveBeenCalledWith("read_delivery_receipt", {
      p_actor_id: id,
      p_property_id: id,
      p_id: id,
    });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("gets a property-scoped saved report for review", async () => {
    await GET(
      new Request(
        `http://localhost/api/delivery?propertyId=${id}&reportId=${other}`,
      ),
    );
    expect(m.rpc).toHaveBeenCalledWith("read_delivery_report", {
      p_actor_id: id,
      p_property_id: id,
      p_report_id: other,
    });
  });
});
