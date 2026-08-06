import { z } from "zod";

const cloudwaysOperationSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  operation_id: z.union([z.string(), z.number()]).optional(),
  // Cloudways returns a boolean request-status envelope alongside string
  // operation statuses; only string statuses describe operation state.
  status: z.union([z.string(), z.boolean()]).optional(),
  is_completed: z.union([z.string(), z.number(), z.boolean()]).optional(),
  operation: z.string().optional(),
  operation_type: z.string().optional(),
  type: z.string().optional(),
  server_id: z.union([z.string(), z.number()]).optional(),
  app_id: z.union([z.string(), z.number()]).optional(),
  application_id: z.union([z.string(), z.number()]).optional(),
  parent_app_id: z.union([z.string(), z.number()]).optional(),
  parent_application_id: z.union([z.string(), z.number()]).optional(),
  production_app_id: z.union([z.string(), z.number()]).optional(),
  staging_app_id: z.union([z.string(), z.number()]).optional(),
  staging_application_id: z.union([z.string(), z.number()]).optional(),
  backup_id: z.union([z.string(), z.number()]).optional(),
  parameters: z.string().optional(),
});

type CloudwaysOperation = z.infer<typeof cloudwaysOperationSchema>;

export type CloudwaysOperationExpectation =
  | {
      kind: "backup";
      serverId: string;
      applicationId: string;
      backupId: string;
    }
  | {
      kind: "promotion";
      serverId: string;
      applicationId: string;
      stagingApplicationId: string;
    }
  | {
      kind: "restore";
      serverId: string;
      applicationId: string;
      backupId: string;
    }
  | {
      kind: "staging";
      serverId: string;
      applicationId: string;
      parentApplicationId: string;
    };

export class CloudwaysUnsupportedOperationError extends Error {
  constructor(readonly operation: "promotion" | "restore") {
    super(
      `Cloudways ${operation} API is unavailable; use the Cloudways dashboard and confirm manually`,
    );
    this.name = "CloudwaysUnsupportedOperationError";
  }
}

const cloudwaysApplicationSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    app_fqdn: z.string().min(1),
    app_user: z.string().min(1),
    app_password: z.string().min(1),
    sys_user: z.string().optional(),
    server_id: z.union([z.string(), z.number()]).optional(),
    public_ip: z.string().optional(),
    master_user: z.string().optional(),
    master_password: z.string().optional(),
    is_staging: z.union([z.string(), z.number(), z.boolean()]).optional(),
    source_app_id: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough();

export function assertStagingApplicationParent(
  application: z.infer<typeof cloudwaysApplicationSchema>,
  expectedParentApplicationId: string,
): void {
  if (
    application.source_app_id === null ||
    application.source_app_id === undefined ||
    String(application.source_app_id) !== expectedParentApplicationId
  ) {
    throw new Error(
      `Cloudways staging application ${application.id} is not a clone of the exact parent application ${expectedParentApplicationId}`,
    );
  }
}

export interface CloudwaysProviderCredentials {
  email: string;
  apiKey: string;
}

export function parseCloudwaysApplicationHostname(value: string): {
  applicationId: string;
  serverId: string;
} | null {
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    hostname = value.trim().toLowerCase();
  }
  // Cloudways preview hosts are wordpress-{server_id}-{app_id}.cloudwaysapps.com
  const match = hostname.match(/^wordpress-(\d+)-(\d+)\.cloudwaysapps\.com$/);
  return match ? { serverId: match[1], applicationId: match[2] } : null;
}

function normalizeHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

export class CloudwaysProviderClient {
  private readonly baseUrl = "https://api.cloudways.com/api/v2";
  private accessToken?: string;

  constructor(private readonly credentials: CloudwaysProviderCredentials) {}

  async createApplication(input: {
    serverId: string;
    label: string;
    appVersion?: string;
  }): Promise<{ operationId: string | null; applicationId: string | null }> {
    // Cloudways API v2 add-app contract. Creating an app is not idempotent;
    // callers must persist the returned operation checkpoint before retrying.
    const appVersion =
      input.appVersion || (await this.getLatestWordPressVersion());
    const response = z
      .object({
        operation_id: z.union([z.string(), z.number()]).optional(),
        id: z.union([z.string(), z.number()]).optional(),
        app_id: z.union([z.string(), z.number()]).optional(),
        application_id: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .parse(
        await this.request("/app", {
          method: "POST",
          query: {
            server_id: input.serverId,
            application: "wordpress",
            app_version: appVersion,
            app_label: input.label,
          },
        }),
      );
    return {
      operationId:
        response.operation_id !== undefined
          ? String(response.operation_id)
          : response.id !== undefined
            ? String(response.id)
            : null,
      applicationId:
        response.application_id !== undefined
          ? String(response.application_id)
          : response.app_id !== undefined
            ? String(response.app_id)
            : null,
    };
  }

  async getLatestWordPressVersion(): Promise<string> {
    const payload = z
      .object({
        apps: z
          .array(
            z
              .object({
                versions: z
                  .array(
                    z
                      .object({
                        application: z.string(),
                        app_version: z.string(),
                      })
                      .passthrough(),
                  )
                  .default([]),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .parse(await this.request("/apps", { method: "GET" }));
    const versions = payload.apps
      .flatMap((app) => app.versions)
      .filter((version) => version.application === "wordpress")
      .map((version) => version.app_version)
      .sort((left, right) =>
        right.localeCompare(left, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    if (!versions[0]) {
      throw new Error(
        "Cloudways did not advertise a supported WordPress application version",
      );
    }
    return versions[0];
  }

  private async fetchWithBackoff(
    request: () => Promise<Response>,
    maxAttempts = 4,
  ): Promise<Response> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await request();
      if (
        ![429, 502, 503, 504].includes(response.status) ||
        attempt === maxAttempts - 1
      ) {
        return response;
      }
      const retryAfter = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
      const retryAfterMs = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1_000
        : 0;
      const backoffMs = Math.min(10_000, 1_000 * 2 ** attempt);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(retryAfterMs, backoffMs)),
      );
    }
    throw new Error("Cloudways request exhausted its retry budget");
  }

  async createApplicationBackup(input: {
    serverId: string;
    applicationId: string;
  }): Promise<{ operationId: string | null }> {
    // Live contract: POST /app/manage/takeBackup?server_id&app_id
    // -> { status: true, operation_id } (backups are identified by
    // restore-point timestamps, not ids; see getLatestRestorePoint).
    const result = cloudwaysOperationSchema.passthrough().parse(
      await this.request("/app/manage/takeBackup", {
        method: "POST",
        query: {
          server_id: input.serverId,
          app_id: input.applicationId,
        },
      }),
    );
    return {
      operationId:
        result.operation_id !== undefined
          ? String(result.operation_id)
          : result.id !== undefined
            ? String(result.id)
            : null,
    };
  }

  async getLatestRestorePoint(input: {
    serverId: string;
    applicationId: string;
  }): Promise<string | null> {
    // GET /app/manage/backup starts an app_restore_points flex operation whose
    // completed record embeds the available backup_dates in its parameters.
    const started = cloudwaysOperationSchema.passthrough().parse(
      await this.request("/app/manage/backup", {
        method: "GET",
        query: {
          server_id: input.serverId,
          app_id: input.applicationId,
        },
      }),
    );
    const operationId =
      started.operation_id !== undefined
        ? String(started.operation_id)
        : started.id !== undefined
          ? String(started.id)
          : null;
    if (!operationId) {
      throw new Error(
        "Cloudways did not return a restore-point lookup operation",
      );
    }
    const operation = await this.waitForOperation(operationId);
    if (typeof operation.parameters !== "string") return null;
    let backupDates: unknown;
    try {
      backupDates = (JSON.parse(operation.parameters) as Record<string, unknown>)
        .backup_dates;
    } catch {
      return null;
    }
    if (!Array.isArray(backupDates) || backupDates.length === 0) return null;
    const dates = backupDates
      .filter((value): value is string => typeof value === "string")
      .sort();
    return dates.length > 0 ? dates[dates.length - 1] : null;
  }

  async promoteStagingApplication(input: {
    serverId: string;
    stagingApplicationId: string;
    productionApplicationId: string;
  }): Promise<{ operationId: string | null }> {
    try {
      // Live contract: POST /staging/sync/app pushes the staging source
      // application onto the destination (production) application.
      const result = cloudwaysOperationSchema.passthrough().parse(
        await this.request("/staging/sync/app", {
          method: "POST",
          query: {
            server_id: input.serverId,
            app_id: input.productionApplicationId,
            source_app_id: input.stagingApplicationId,
            source_server_id: input.serverId,
            action: "push",
            appFiles: "true",
            dbFiles: "true",
            backup: "true",
          },
        }),
      );
      return {
        operationId:
          result.operation_id !== undefined
            ? String(result.operation_id)
            : result.id !== undefined
              ? String(result.id)
              : null,
      };
    } catch (error) {
      if (isUnsupportedProviderError(error)) {
        throw new CloudwaysUnsupportedOperationError("promotion");
      }
      throw error;
    }
  }

  async restoreApplicationBackup(input: {
    serverId: string;
    applicationId: string;
    backupId: string;
  }): Promise<{ operationId: string | null }> {
    try {
      // Live contract: POST /app/manage/restore?server_id&app_id&time&type,
      // where `time` is the restore-point timestamp captured after backup.
      const result = cloudwaysOperationSchema.passthrough().parse(
        await this.request("/app/manage/restore", {
          method: "POST",
          query: {
            server_id: input.serverId,
            app_id: input.applicationId,
            time: input.backupId,
            type: "complete",
          },
        }),
      );
      return {
        operationId:
          result.operation_id !== undefined
            ? String(result.operation_id)
            : result.id !== undefined
              ? String(result.id)
              : null,
      };
    } catch (error) {
      if (isUnsupportedProviderError(error)) {
        throw new CloudwaysUnsupportedOperationError("restore");
      }
      throw error;
    }
  }

  async createStagingApplication(input: {
    serverId: string;
    parentApplicationId: string;
    label: string;
  }): Promise<{ operationId: string | null; applicationId: string | null }> {
    const response = z
      .object({
        operation_id: z.union([z.string(), z.number()]).optional(),
        id: z.union([z.string(), z.number()]).optional(),
        app_id: z.union([z.string(), z.number()]).optional(),
        application_id: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .parse(
        await this.request("/staging/app/cloneApp", {
          method: "POST",
          query: {
            server_id: input.serverId,
            app_id: input.parentApplicationId,
          },
        }),
      );
    return {
      operationId:
        response.operation_id !== undefined
          ? String(response.operation_id)
          : response.id !== undefined
            ? String(response.id)
            : null,
      applicationId:
        response.application_id !== undefined
          ? String(response.application_id)
          : response.app_id !== undefined
            ? String(response.app_id)
            : null,
    };
  }

  async setStagingAuthStatus(input: {
    serverId: string;
    applicationId: string;
    action: "enable" | "disable";
  }): Promise<{ operationId: string | null }> {
    const accessToken = await this.authenticate();
    // Cloudflare in front of the Cloudways API rejects this POST with query
    // params; it only accepts a form-encoded body.
    const response = await this.fetchWithBackoff(() =>
      fetch(`${this.baseUrl}/staging/auth/status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          server_id: input.serverId,
          app_id: input.applicationId,
          action: input.action,
        }),
        signal: AbortSignal.timeout(60_000),
      }),
    );
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as Record<string, unknown>).message)
          : "Unknown Cloudways error";
      throw new Error(
        `Cloudways staging auth ${input.action} failed (${response.status}): ${message}`,
      );
    }
    const parsed = z
      .object({
        operation_id: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .parse(payload);
    return {
      operationId:
        parsed.operation_id !== undefined
          ? String(parsed.operation_id)
          : null,
    };
  }

  async waitForOperation(
    operationId: string,
    timeoutMs = 30 * 60_000,
  ): Promise<CloudwaysOperation> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const operation = await this.getOperation(operationId);
      const status =
        typeof operation.status === "string"
          ? operation.status.toLowerCase()
          : undefined;
      if (status && ["failed", "error", "cancelled", "canceled"].includes(status)) {
        throw new Error(`Cloudways operation ${operationId} ${status}`);
      }
      if (
        operation.is_completed === true ||
        operation.is_completed === 1 ||
        operation.is_completed === "1"
      ) {
        return operation;
      }
      if (
        status &&
        ["completed", "complete", "success", "succeeded"].includes(status)
      ) {
        return operation;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(`Cloudways operation ${operationId} timed out`);
  }

  async getOperation(operationId: string): Promise<CloudwaysOperation> {
    const payload = await this.request(
      `/operation/${encodeURIComponent(operationId)}`,
      { method: "GET" },
    );
    // Cloudways nests the operation record under an `operation` key:
    // { "status": <bool>, "operation": { id, is_completed, type, app_id, ... } }
    const unwrapped =
      payload &&
      typeof payload === "object" &&
      "operation" in payload &&
      (payload as Record<string, unknown>).operation &&
      typeof (payload as Record<string, unknown>).operation === "object"
        ? (payload as Record<string, unknown>).operation
        : payload;
    return cloudwaysOperationSchema.passthrough().parse(unwrapped);
  }

  async verifyOperation(
    operationId: string,
    expected: CloudwaysOperationExpectation,
  ): Promise<CloudwaysOperation> {
    const operation = await this.getOperation(operationId);
    assertCompletedCloudwaysOperation(operationId, operation);
    assertCloudwaysOperationOwnership(operationId, operation, expected);
    return operation;
  }

  async getApplication(input: {
    serverId: string;
    applicationId: string | null;
    expectedHostname?: string;
  }): Promise<z.infer<typeof cloudwaysApplicationSchema>> {
    if (!input.applicationId) {
      throw new Error(
        "Cloudways application identity is required; refusing to select an arbitrary sibling application",
      );
    }
    const response = z
      .object({
        servers: z
          .array(
            z
              .object({
                id: z.union([z.string(), z.number()]),
                public_ip: z.string().optional(),
                master_user: z.string().optional(),
                master_password: z.string().optional(),
                apps: z.array(cloudwaysApplicationSchema).default([]),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      // /server (singular) returns servers with embedded apps and credentials;
      // /servers (plural) is a paginated summary without apps.
      .parse(await this.request("/server", { method: "GET" }));
    const server = response.servers.find(
      (candidate) => String(candidate.id) === input.serverId,
    );
    let application = server?.apps.find((candidate) =>
      String(candidate.id) === input.applicationId,
    );
    let applicationServer = server;
    if ((!application || !applicationServer) && input.expectedHostname) {
      const expectedHostname = normalizeHostname(input.expectedHostname);
      const matches = response.servers.flatMap((candidate) =>
        candidate.apps
          .filter(
            (app) => normalizeHostname(app.app_fqdn) === expectedHostname,
          )
          .map((app) => ({ app, server: candidate })),
      );
      if (matches.length === 1) {
        application = matches[0].app;
        applicationServer = matches[0].server;
      }
    }
    if (!applicationServer || !application) {
      throw new Error(
        "Exact Cloudways application was not found by provider identity or hostname",
      );
    }
    return cloudwaysApplicationSchema.parse({
      ...application,
      server_id: applicationServer.id,
      public_ip: applicationServer.public_ip,
      master_user: applicationServer.master_user,
      master_password: applicationServer.master_password,
    });
  }

  async configureApplicationDomain(input: {
    applicationId: string;
    domain: string;
  }): Promise<void> {
    const domain = z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/)
      .parse(input.domain);
    const applicationId = encodeURIComponent(input.applicationId);
    await this.request(`/applications/${applicationId}/cname`, {
      method: "PUT",
      body: { new_cname: domain },
    });
    await this.request(
      `/security/ssl/lets-encrypt/install?domain=${encodeURIComponent(domain)}`,
      {
        method: "POST",
        body: { application_id: input.applicationId },
      },
    );
    await this.request(`/applications/${applicationId}/enforce-https`, {
      method: "POST",
    });
  }

  async verifyDns(domain: string): Promise<unknown> {
    return this.request("/security/dns/verify", {
      method: "POST",
      body: { domain },
    });
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (this.credentials.apiKey.startsWith("cw_")) {
      this.accessToken = this.credentials.apiKey;
      return this.accessToken;
    }

    const response = await this.fetchWithBackoff(() =>
      fetch(`${this.baseUrl}/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email: this.credentials.email,
          api_key: this.credentials.apiKey,
        }),
        signal: AbortSignal.timeout(30_000),
      }),
    );
    const payload = (await response.json()) as {
      access_token?: string;
      message?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Cloudways authentication failed (${response.status}): ${
          payload.message || "missing access token"
        }`,
      );
    }
    this.accessToken = payload.access_token;
    return payload.access_token;
  }

  private async request(
    endpoint: string,
    init: {
      method: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      query?: Record<string, string | number>;
    },
  ): Promise<unknown> {
    const accessToken = await this.authenticate();
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(init.query || {})) {
      url.searchParams.set(key, String(value));
    }
    const requestUrl = init.query
      ? url.toString()
      : `${this.baseUrl}${endpoint}`;
    const response = await this.fetchWithBackoff(() =>
      fetch(requestUrl, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(60_000),
      }),
    );
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : "Unknown Cloudways error";
      throw new Error(
        `Cloudways API ${init.method} ${endpoint} failed (${response.status}): ${message}`,
      );
    }
    if (
      payload &&
      typeof payload === "object" &&
      "data" in payload &&
      (payload as Record<string, unknown>).data !== undefined
    ) {
      return (payload as Record<string, unknown>).data;
    }
    return payload;
  }
}

function isUnsupportedProviderError(error: unknown): boolean {
  return (
    error instanceof Error && /failed \((?:404|405|501)\):/.test(error.message)
  );
}

function operationValue(
  operation: CloudwaysOperation,
  keys: Array<keyof CloudwaysOperation>,
): string | null {
  for (const key of keys) {
    const value = operation[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

function normalizeOperationType(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function assertCompletedCloudwaysOperation(
  operationId: string,
  operation: CloudwaysOperation,
): void {
  const returnedOperationId = operationValue(operation, ["operation_id", "id"]);
  if (returnedOperationId !== operationId) {
    throw new Error(
      `Cloudways operation response does not match requested operation ${operationId}`,
    );
  }
  const status =
    typeof operation.status === "string"
      ? operation.status.trim().toLowerCase()
      : undefined;
  if (status && ["failed", "error", "cancelled", "canceled"].includes(status)) {
    throw new Error(`Cloudways operation ${operationId} ${status}`);
  }
  const completed =
    operation.is_completed === true ||
    operation.is_completed === 1 ||
    operation.is_completed === "1" ||
    Boolean(
      status &&
        ["completed", "complete", "success", "succeeded"].includes(status),
    );
  if (!completed) {
    throw new Error(
      `Cloudways operation ${operationId} does not have a verified successful status`,
    );
  }
}

function assertCloudwaysOperationOwnership(
  operationId: string,
  operation: CloudwaysOperation,
  expected: CloudwaysOperationExpectation,
): void {
  const rawType = operationValue(operation, [
    "operation_type",
    "operation",
    "type",
  ]);
  const aliases: Record<CloudwaysOperationExpectation["kind"], string[]> = {
    backup: [
      "backup",
      "application_backup",
      "app_backup",
      "take_backup",
      "app_level_backup",
    ],
    promotion: [
      "promotion",
      "push_to_live",
      "pushtolive",
      "staging_push_to_live",
      "sync_app",
      "app_sync",
      "staging_sync_app",
      "staging_sync",
    ],
    restore: ["restore", "restore_backup", "application_restore", "restore_app"],
    staging: ["staging", "create_staging", "createstaging", "add_staging_app"],
  };
  if (
    !rawType ||
    !aliases[expected.kind].includes(normalizeOperationType(rawType))
  ) {
    throw new Error(
      `Cloudways operation ${operationId} is not a verified ${expected.kind} operation`,
    );
  }

  const serverId = operationValue(operation, ["server_id"]);
  const applicationId =
    expected.kind === "staging"
      ? operationValue(operation, [
          "staging_application_id",
          "staging_app_id",
          "application_id",
          "app_id",
        ])
      : operationValue(operation, [
          "production_app_id",
          "application_id",
          "app_id",
          "parent_application_id",
          "parent_app_id",
        ]);
  const applicationMatches =
    applicationId === expected.applicationId ||
    // Cloudways sync_app operations may report the staging source app id.
    (expected.kind === "promotion" &&
      applicationId === expected.stagingApplicationId);
  if (serverId !== expected.serverId || !applicationMatches) {
    throw new Error(
      `Cloudways operation ${operationId} does not belong to the exact production server/application`,
    );
  }

  if (expected.kind === "promotion") {
    const stagingApplicationId = operationValue(operation, [
      "staging_application_id",
      "staging_app_id",
    ]);
    if (
      stagingApplicationId !== null &&
      stagingApplicationId !== expected.stagingApplicationId
    ) {
      throw new Error(
        `Cloudways operation ${operationId} does not belong to the exact staging child application`,
      );
    }
  } else if (expected.kind === "staging") {
    // Cloudways add_staging_app operations omit the parent application id;
    // when absent, parent linkage is enforced against the staging app's
    // source_app_id record instead (see assertStagingApplicationParent).
    const parentApplicationId = operationValue(operation, [
      "parent_app_id",
      "parent_application_id",
      "production_app_id",
    ]);
    if (
      parentApplicationId !== null &&
      parentApplicationId !== expected.parentApplicationId
    ) {
      throw new Error(
        `Cloudways operation ${operationId} does not belong to the exact parent application`,
      );
    }
  } else {
    // Cloudways backup/restore operations do not carry a backup identity in
    // the payload; backups are addressed by restore-point timestamps that the
    // caller records via getLatestRestorePoint. Only enforce when present.
    const backupId = operationValue(operation, ["backup_id"]);
    if (backupId !== null && backupId !== expected.backupId) {
      throw new Error(
        `Cloudways operation ${operationId} does not reference the recorded backup`,
      );
    }
  }
}
