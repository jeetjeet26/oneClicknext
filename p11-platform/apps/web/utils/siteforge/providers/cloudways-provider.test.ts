import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudwaysProviderClient,
  CloudwaysUnsupportedOperationError,
  assertStagingApplicationParent,
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
      serverId: "1655141",
      applicationId: "6587075",
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

  it("creates staging through the Cloudways staging clone endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        data: {
          operation_id: "operation-123",
          application_id: "staging-456",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).createStagingApplication({
        serverId: "server-123",
        parentApplicationId: "production-456",
        label: "ignored-by-cloudways-staging-clone",
      }),
    ).resolves.toEqual({
      operationId: "operation-123",
      applicationId: "staging-456",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudways.com/api/v2/staging/app/cloneApp?server_id=server-123&app_id=production-456",
      expect.objectContaining({
        method: "POST",
        body: undefined,
      }),
    );
  });

  it("creates a dedicated WordPress application through the add-app endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        data: {
          operation_id: "operation-789",
          app_id: "production-456",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).createApplication({
        serverId: "server-123",
        label: "siteforge-aurora",
        appVersion: "6.8.1",
      }),
    ).resolves.toEqual({
      operationId: "operation-789",
      applicationId: "production-456",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudways.com/api/v2/app?server_id=server-123&application=wordpress&app_version=6.8.1&app_label=siteforge-aurora",
      expect.objectContaining({
        method: "POST",
        body: undefined,
      }),
    );
  });

  it("discovers the latest supported WordPress version before creating an app", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: {
            apps: [
              {
                label: "WordPress",
                versions: [
                  { application: "wordpress", app_version: "6.8.1" },
                  { application: "wordpress", app_version: "6.9.0" },
                ],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        response({ data: { operation_id: "operation-790" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await new CloudwaysProviderClient({
      email: "ops@example.com",
      apiKey: "cw_access-token",
    }).createApplication({
      serverId: "server-123",
      label: "siteforge-current-wordpress",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.cloudways.com/api/v2/apps",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("app_version=6.9.0"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("disables staging htaccess auth with a form-encoded body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        status: true,
        operation_id: "flex-92994091",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).setStagingAuthStatus({
        serverId: "1655141",
        applicationId: "6599441",
        action: "disable",
      }),
    ).resolves.toEqual({ operationId: "flex-92994091" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cloudways.com/api/v2/staging/auth/status");
    expect(init).toMatchObject({ method: "POST" });
    expect(String(init?.body)).toBe(
      "server_id=1655141&app_id=6599441&action=disable",
    );
    expect(
      (init?.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/x-www-form-urlencoded");
  });

  it("verifies live add_staging_app operations nested under the operation envelope", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        status: false,
        operation: {
          id: "130490119",
          operation_id: "130490119",
          type: "add_staging_app",
          is_completed: "1",
          server_id: "1655141",
          app_id: "6597815",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).verifyOperation("130490119", {
        kind: "staging",
        serverId: "1655141",
        applicationId: "6597815",
        parentApplicationId: "6587075",
      }),
    ).resolves.toMatchObject({
      operation_id: "130490119",
      app_id: "6597815",
    });
  });

  it("rejects staging applications that are not clones of the exact parent", async () => {
    const application = {
      id: "6597815",
      app_fqdn: "wordpress-1655141-6597815.cloudwaysapps.com",
      app_user: "user",
      app_password: "password",
      is_staging: "1",
      source_app_id: "9999999",
    };
    expect(() =>
      assertStagingApplicationParent(application, "6587075"),
    ).toThrow(/not a clone of the exact parent application/);
    expect(() =>
      assertStagingApplicationParent(
        { ...application, source_app_id: "6587075" },
        "6587075",
      ),
    ).not.toThrow();
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
      "https://api.cloudways.com/api/v2/staging/app/cloneApp?server_id=server-1&app_id=parent-app-1",
      expect.objectContaining({
        method: "POST",
        body: undefined,
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

  it("takes an application backup through the manage endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ status: true, operation_id: "backup-op" }),
      )
      .mockResolvedValueOnce(response({ data: { status: "completed" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CloudwaysProviderClient({
      email: "ops@example.com",
      apiKey: "cw_access-token",
    });

    await expect(
      client.createApplicationBackup({
        serverId: "server-1",
        applicationId: "production-app",
      }),
    ).resolves.toEqual({
      operationId: "backup-op",
    });
    await client.waitForOperation("backup-op");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.cloudways.com/api/v2/app/manage/takeBackup?server_id=server-1&app_id=production-app",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.cloudways.com/api/v2/operation/backup-op",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("resolves the newest restore point from the flex restore-points operation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ status: true, operation_id: "flex-1" }),
      )
      .mockResolvedValueOnce(
        response({
          status: true,
          operation: {
            id: "flex-1",
            type: "app_restore_points",
            is_completed: "1",
            parameters: JSON.stringify({
              backup_dates: ["2026-08-01T10:00:00", "2026-08-05T23:19:06"],
            }),
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).getLatestRestorePoint({
        serverId: "server-1",
        applicationId: "production-app",
      }),
    ).resolves.toBe("2026-08-05T23:19:06");
  });

  it("restores an application to an exact restore point timestamp", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ status: true, operation_id: "restore-op" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new CloudwaysProviderClient({
        email: "ops@example.com",
        apiKey: "cw_access-token",
      }).restoreApplicationBackup({
        serverId: "server-1",
        applicationId: "production-app",
        backupId: "2026-08-05T23:19:06",
      }),
    ).resolves.toEqual({ operationId: "restore-op" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudways.com/api/v2/app/manage/restore?server_id=server-1&app_id=production-app&time=2026-08-05T23%3A19%3A06&type=complete",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pushes staging to live through the staging sync endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ status: true, operation_id: "sync-op" }),
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
    ).resolves.toEqual({ operationId: "sync-op" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudways.com/api/v2/sync/app?server_id=server-1&app_id=staging-1&source_app_id=production-1&source_server_id=server-1&action=push&appFiles=true&dbFiles=true&backup=true",
      expect.objectContaining({ method: "POST" }),
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
