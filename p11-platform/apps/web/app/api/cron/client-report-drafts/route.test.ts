import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), start: vi.fn(), finish: vi.fn() }));
vi.mock("@/utils/delivery/server", () => ({ deliveryRpc: m.rpc }));
vi.mock("@/utils/services/cron-job-runs", () => ({
  startCronJobRun: m.start,
  finishCronJobRun: m.finish,
}));
import { GET, POST } from "./route";
const request = (token = "test") =>
  new Request("http://localhost/api/cron/client-report-drafts", {
    headers: { authorization: "Bearer " + token },
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "test");
  vi.stubEnv("CLIENT_REPORT_DRAFTS_ENABLED", "true");
  m.start.mockResolvedValue({ id: "run" });
  m.finish.mockResolvedValue(true);
  m.rpc.mockResolvedValue({
    state: "ready",
    results: [{ propertyId: "p", result: { state: "saved" } }],
  });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthorized scheduler calls", async () => {
  expect((await GET(request("wrong"))).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("stays disabled until the release enables it", async () => {
  vi.stubEnv("CLIENT_REPORT_DRAFTS_ENABLED", "false");
  expect(await (await GET(request())).json()).toEqual({ state: "disabled" });
  expect(m.start).not.toHaveBeenCalled();
});
it("records completion for draft creation without delivery", async () => {
  expect((await GET(request())).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("draft_due_client_reports", {
    p_limit: 10,
  });
  expect(m.finish).toHaveBeenCalledWith(
    { id: "run" },
    {
      status: "success",
      summary: { prepared: 1, failed: 0, publication: "staff_review_required" },
    },
  );
});
it("does no work if the run cannot be recorded", async () => {
  m.start.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(503);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("does not conceal an unconfirmed completion", async () => {
  m.finish.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(503);
});
it("records database failure and leaves recovery to exact monthly identity", async () => {
  m.rpc.mockRejectedValue(Error("interrupted"));
  expect((await POST(request())).status).toBe(503);
  expect(m.finish).toHaveBeenCalledWith(
    { id: "run" },
    expect.objectContaining({ status: "failed" }),
  );
});
