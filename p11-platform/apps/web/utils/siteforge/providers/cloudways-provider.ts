import { z } from "zod";

const cloudwaysOperationSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  operation_id: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
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
    server_id: z.union([z.string(), z.number()]).optional(),
    public_ip: z.string().optional(),
  })
  .passthrough();

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
  const match = hostname.match(/^wordpress-(\d+)-(\d+)\.cloudwaysapps\.com$/);
  return match ? { applicationId: match[1], serverId: match[2] } : null;
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

  async createApplicationBackup(applicationId: string): Promise<{
    operationId: string | null;
    backupId: string | null;
  }> {
    const result = cloudwaysOperationSchema
      .extend({
        backup_id: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .parse(
        await this.request(
          `/applications/${encodeURIComponent(applicationId)}/backup`,
          {
            method: "POST",
          },
        ),
      );
    return {
      operationId:
        result.operation_id !== undefined
          ? String(result.operation_id)
          : result.id !== undefined
            ? String(result.id)
            : null,
      backupId:
        result.backup_id !== undefined ? String(result.backup_id) : null,
    };
  }

  async promoteStagingApplication(input: {
    serverId: string;
    stagingApplicationId: string;
    productionApplicationId: string;
  }): Promise<{ operationId: string | null }> {
    try {
      const result = cloudwaysOperationSchema.passthrough().parse(
        await this.request("/app/pushtolive", {
          method: "POST",
          body: {
            server_id: input.serverId,
            app_id: input.productionApplicationId,
            staging_app_id: input.stagingApplicationId,
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
    applicationId: string;
    backupId: string;
  }): Promise<{ operationId: string | null }> {
    try {
      const result = cloudwaysOperationSchema.passthrough().parse(
        await this.request(
          `/applications/${encodeURIComponent(input.applicationId)}/restore`,
          {
            method: "POST",
            body: { backup_id: input.backupId },
          },
        ),
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
        await this.request("/app/createstaging", {
          method: "POST",
          body: {
            server_id: input.serverId,
            app_id: input.parentApplicationId,
            app_label: input.label.replace(/[^a-z0-9-]/gi, "-").slice(0, 48),
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

  async waitForOperation(
    operationId: string,
    timeoutMs = 30 * 60_000,
  ): Promise<CloudwaysOperation> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const operation = await this.getOperation(operationId);
      const status = operation.status?.toLowerCase();
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
    return cloudwaysOperationSchema.passthrough().parse(
      await this.request(`/operation/${encodeURIComponent(operationId)}`, {
        method: "GET",
      }),
    );
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
                apps: z.array(cloudwaysApplicationSchema).default([]),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .parse(await this.request("/servers", { method: "GET" }));
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
    init: { method: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
  ): Promise<unknown> {
    const accessToken = await this.authenticate();
    const response = await this.fetchWithBackoff(() =>
      fetch(`${this.baseUrl}${endpoint}`, {
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
  const status = operation.status?.trim().toLowerCase();
  if (status && ["failed", "error", "cancelled", "canceled"].includes(status)) {
    throw new Error(`Cloudways operation ${operationId} ${status}`);
  }
  const completed = Boolean(
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
    backup: ["backup", "application_backup", "app_backup", "take_backup"],
    promotion: [
      "promotion",
      "push_to_live",
      "pushtolive",
      "staging_push_to_live",
    ],
    restore: ["restore", "restore_backup", "application_restore"],
    staging: ["staging", "create_staging", "createstaging"],
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
        ])
      : operationValue(operation, [
          "production_app_id",
          "application_id",
          "app_id",
          "parent_application_id",
          "parent_app_id",
        ]);
  if (
    serverId !== expected.serverId ||
    applicationId !== expected.applicationId
  ) {
    throw new Error(
      `Cloudways operation ${operationId} does not belong to the exact production server/application`,
    );
  }

  if (expected.kind === "promotion") {
    const stagingApplicationId = operationValue(operation, [
      "staging_application_id",
      "staging_app_id",
    ]);
    if (stagingApplicationId !== expected.stagingApplicationId) {
      throw new Error(
        `Cloudways operation ${operationId} does not belong to the exact staging child application`,
      );
    }
  } else if (expected.kind === "staging") {
    const parentApplicationId = operationValue(operation, [
      "parent_app_id",
      "parent_application_id",
      "production_app_id",
    ]);
    if (parentApplicationId !== expected.parentApplicationId) {
      throw new Error(
        `Cloudways operation ${operationId} does not belong to the exact parent application`,
      );
    }
  } else {
    const backupId = operationValue(operation, ["backup_id"]);
    if (backupId !== expected.backupId) {
      throw new Error(
        `Cloudways operation ${operationId} does not reference the recorded backup`,
      );
    }
  }
}
