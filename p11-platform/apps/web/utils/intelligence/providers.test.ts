import { describe, it, expect, vi } from "vitest";
import { retrieveProvider, type Binding } from "./providers";
const propertyId = "11111111-1111-4111-8111-111111111111";
describe("real provider response adapters", () => {
  it("uses the Search Console API and preserves search/device/page grain", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rows: [
            {
              keys: ["2026-10-01", "MOBILE", "https://example.test/floorplans"],
              clicks: 5,
              impressions: 100,
            },
          ],
        }),
      ),
    );
    const result = await retrieveProvider(
      {
        provider: "search_console",
        propertyId,
        siteUrl: "sc-domain:example.test",
        accessToken: "test",
      },
      "2026-10-01",
      "2026-10-01",
      f,
    );
    expect(result.rows.map((r) => r.metric)).toEqual([
      "search_clicks",
      "search_impressions",
    ]);
    expect(result.rows[0].device).toBe("mobile");
    expect(f.mock.calls[0][0]).toContain(
      "www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.test/searchAnalytics/query",
    );
    expect(result.limitations.join()).toContain("omit");
  });
  it("pages CallRail and strips all contact and recording details", async () => {
    const f = vi.fn().mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify({
            total_pages: 2,
            calls: [
              {
                id: url.includes("page=2&") ? "call2" : "call1",
                company_id: "COM1",
                start_time: "2026-10-01T12:00:00-07:00",
                answered: true,
                source: "Google",
                lead_status: "good_lead",
                customer_name: "PRIVATE",
                recording: "PRIVATE",
              },
            ],
          }),
        ),
    );
    const r = await retrieveProvider(
      {
        provider: "callrail",
        propertyId,
        accountId: "ACC1",
        companyId: "COM1",
        apiKey: "test",
      },
      "2026-10-01",
      "2026-10-01",
      f,
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.rows.filter((r) => r.metric === "calls")).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain("PRIVATE");
  });
  it("does not label an active Buildium lease as a signed or attributed lease", async () => {
    const f = vi.fn().mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("rentals/units")
              ? [
                  {
                    Id: 1,
                    PropertyId: 12,
                    IsUnitListed: true,
                    IsUnitOccupied: false,
                    MarketRent: 2200,
                  },
                ]
              : [
                  {
                    Id: 2,
                    PropertyId: 12,
                    LeaseStatus: "Active",
                    CurrentTenants: [{ FirstName: "PRIVATE" }],
                  },
                ],
          ),
        ),
    );
    const r = await retrieveProvider(
      {
        provider: "buildium",
        propertyId,
        rentalPropertyId: 12,
        clientId: "test",
        clientSecret: "test",
        sandbox: true,
      },
      "2026-10-01",
      "2026-10-01",
      f,
    );
    expect(r.rows.map((r) => r.metric)).toEqual([
      "available_units",
      "market_rent",
      "active_leases",
    ]);
    expect(JSON.stringify(r)).not.toContain("PRIVATE");
    expect(f.mock.calls[0][0]).toContain("apisandbox.buildium.com");
  });
  it("rejects cross-property PMS responses and does not save partial failures", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ Id: 1, PropertyId: 99 }])),
      );
    const config: Binding = {
      provider: "buildium",
      propertyId,
      rentalPropertyId: 12,
      clientId: "test",
      clientSecret: "test",
      sandbox: true,
    };
    await expect(
      retrieveProvider(config, "2026-10-01", "2026-10-01", f),
    ).rejects.toThrow("another property");
  });
  it("never follows provider redirects with credentials", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 302 }));
    await expect(
      retrieveProvider(
        {
          provider: "search_console",
          propertyId,
          siteUrl: "sc-domain:example.test",
          accessToken: "test",
        },
        "2026-10-01",
        "2026-10-01",
        f,
      ),
    ).rejects.toThrow("302");
    expect(f.mock.calls[0][1].redirect).toBe("error");
  });
});
