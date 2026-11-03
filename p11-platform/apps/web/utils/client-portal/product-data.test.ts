import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ scope: vi.fn(), from: vi.fn() }));
vi.mock("./server", async () => ({ clientScope: m.scope, PortalError: (await import("@/utils/knowledge/inventory")).InventoryError }));
vi.mock("@/utils/supabase/admin", () => ({ createServiceClient: () => ({ from: m.from }) }));
import { readClientProduct } from "./product-data";
const scope = { name: "Client", revision: 1, products: ["marketvision", "reviewflow"], properties: [{ id: "assigned", name: "Assigned property" }] };
let chain: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.resetAllMocks();
  m.scope.mockResolvedValue(scope);
  chain = Object.fromEntries(["select", "in", "eq", "order", "limit"].map(key => [key, vi.fn()]));
  for (const f of Object.values(chain)) f.mockReturnValue(chain);
  chain.limit.mockResolvedValue({ data: [], error: null });
  m.from.mockReturnValue(chain);
});
describe("client product boundaries", () => {
  it.each(["marketvision", "reviewflow"] as const)("rejects hidden %s before querying", async product => {
    m.scope.mockResolvedValue({ ...scope, products: [] });
    await expect(readClientProduct("client", product)).rejects.toMatchObject({ status: 403 });
    expect(m.from).not.toHaveBeenCalled();
  });
  it("limits reviews to assigned properties and public fields", async () => {
    await readClientProduct("client", "reviewflow");
    expect(chain.in).toHaveBeenCalledWith("property_id", ["assigned"]);
    expect(chain.select).toHaveBeenCalledWith("id,property_id,platform,rating,review_text,review_date");
  });
  it("limits competitors to assigned properties and excludes notes", async () => {
    await readClientProduct("client", "marketvision");
    expect(chain.in).toHaveBeenCalledWith("property_id", ["assigned"]);
    expect(chain.eq).toHaveBeenCalledWith("is_active", true);
    expect(chain.select).toHaveBeenCalledWith("id,property_id,name,address,last_scraped_at");
  });
  it("rejects results if access changes during the request", async () => {
    m.scope.mockResolvedValueOnce(scope).mockResolvedValueOnce({ ...scope, revision: 2, products: [] });
    await expect(readClientProduct("client", "reviewflow")).rejects.toMatchObject({ status: 409 });
  });
});
