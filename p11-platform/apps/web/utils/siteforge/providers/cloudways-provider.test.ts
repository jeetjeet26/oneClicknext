import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudwaysProviderClient,
  CloudwaysUnsupportedOperationError,
  parseCloudwaysApplicationHostname,
} from "./cloudways-provider";

function response(payload: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("Cloudways API v2 provider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("derives immutable Cloudways application identity from preview hosts", () => {
    expect(
      parseCloudwaysApplicationHostname(
        "https://wordpress-1655141-6587075.cloudwaysapps.com/",
      ),
    ).toEqual({
      applicationId: "1655141",
      serverId: "6587075",
    });
    expect(
      parseCloudwaysApplicationHostname("https://apartments.example.com"),
    ).toBeNull();
  });

  it("resolves an exact preview hostname when legacy URL ids drift", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        servers: [
          {
            id: "actual-server",
            public_ip: "192.0.2.10",
            apps: [
              {
                id: "actual-application",
                app_fqdn:
                  "wordpress-1655141-6587075.cloudwaysapps.com",
                app_user: "siteforge-user",
                app_password: "siteforge-password",
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).getApplication({
        serverId: "6587075",
        applicationId: "1655141",
        expectedHostname:
          "https://wordpress-1655141-6587075.cloudwaysapps.com",
      }),
    ).resolves.toMatchObject({
      id: "actual-application",
      server_id: "actual-server",
      public_ip: "192.0.2.10",
    });
  });

  it("attaches a verified domain, installs SSL, and enforces HTTPS", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ access_token: "token" }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}));
    vi.stubGlobal("fetch", fetchMock);

    await new CloudwaysProviderClient({
      email: "ops@example.com",
      apiKey: "cw-key",
    }).configureApplicationDomain({
      applicationId: "app-123",
      domain: "apartments.example.com",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.cloudways.com/api/v2/oauth/access_token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.cloudways.com/api/v2/applications/app-123/cname",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.cloudways.com/api/v2/applications/app-123/enforce-https",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses modern Cloudways access tokens directly as bearer credentials", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: {} }))
      .mockResolvedValueOnce(response({ data: {} }))
      .mockResolvedValueOnce(response({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await new CloudwaysProviderClient({
      email: "ops@example.com",
      apiKey: "cw_access-token",
    }).configureApplicationDomain({
      applicationId: "app-123",
      domain: "apartments.example.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.cloudways.com/api/v2/applications/app-123/cname",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer cw_access-token",
        }),
      }),
    );
  });

  it("rejects invalid domains before provider mutations", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw-key",
      }).configureApplicationDomain({
        applicationId: "app-123",
        domain: "not a domain",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a staging application linked to its parent app", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ access_token: "token" }))
      .mockResolvedValueOnce(
        response({ operation_id: "operation-1", app_id: "staging-app-1" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new CloudwaysProviderClient({
      email: "ops@example.com",
      apiKey: "cw-key",
    }).createStagingApplication({
      serverId: "server-1",
      parentApplicationId: "parent-app-1",
      label: "Property Staging",
    });

    expect(result).toEqual({
      operationId: "operation-1",
      applicationId: "staging-app-1",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.cloudways.com/api/v2/app/createstaging",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"app_id":"parent-app-1"'),
      }),
    );
  });

  it("backs off and retries Cloudways rate limits during provisioning", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(response({ access_token: "token" }))
      .mockResolvedValueOnce(response({}, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(
        response({ operation_id: "operation-1", app_id: "staging-app-1" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const pending = new CloudwaysProviderClient({
      email: "ops@example.com",
      apiKey: "cw-key",
    }).createStagingApplication({
      serverId: "server-1",
      parentApplicationId: "parent-app-1",
      label: "Property Staging",
    });

    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({
      operationId: "operation-1",
      applicationId: "staging-app-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("checkpoints backup identity and polls the returned operation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: { operation_id: "backup-op", backup_id: "backup-1" },
        }),
      )
      .mockResolvedValueOnce(response({ data: { status: "completed" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CloudwaysProviderClient({
      email: "ops@example.com",
      apiKey: "cw_access-token",
    });

    await expect(
      client.createApplicationBackup("production-app"),
    ).resolves.toEqual({
      operationId: "backup-op",
      backupId: "backup-1",
    });
    await client.waitForOperation("backup-op");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.cloudways.com/api/v2/operation/backup-op",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("verifies completed promotion ownership for the exact parent and child", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        data: {
          operation_id: "promotion-op",
          operation_type: "push_to_live",
          status: "completed",
          server_id: "server-1",
          production_app_id: "production-1",
          staging_app_id: "staging-1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).verifyOperation("promotion-op", {
        kind: "promotion",
        serverId: "server-1",
        applicationId: "production-1",
        stagingApplicationId: "staging-1",
      }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("rejects completed operations belonging to a sibling application", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        data: {
          operation_id: "promotion-op",
          operation_type: "push_to_live",
          status: "completed",
          server_id: "server-1",
          production_app_id: "sibling-production",
          staging_app_id: "staging-1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).verifyOperation("promotion-op", {
        kind: "promotion",
        serverId: "server-1",
        applicationId: "production-1",
        stagingApplicationId: "staging-1",
      }),
    ).rejects.toThrow("exact production server/application");
  });

  it("rejects failed operations even when the completion flag is set", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        data: {
          operation_id: "restore-op",
          operation_type: "restore_backup",
          status: "failed",
          is_completed: 1,
          server_id: "server-1",
          app_id: "production-1",
          backup_id: "backup-1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).verifyOperation("restore-op", {
        kind: "restore",
        serverId: "server-1",
        applicationId: "production-1",
        backupId: "backup-1",
      }),
    ).rejects.toThrow("failed");
  });

  it("uses an explicit manual fallback when push-to-live is unsupported", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ message: "endpoint unavailable" }, 404),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).promoteStagingApplication({
        serverId: "server-1",
        stagingApplicationId: "staging-1",
        productionApplicationId: "production-1",
      }),
    ).rejects.toBeInstanceOf(CloudwaysUnsupportedOperationError);
  });
});
