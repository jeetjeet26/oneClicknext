import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from "@/utils/services/auth-guard";
import {
  payloadSchemas,
  factUsable,
  type Command,
  type Document,
  type Kind,
} from "./contracts";
export class IntelligenceError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}
// Strict domain projection of the generated tables; SQL constraints and payload schemas enforce these unions.
type Domain = {
  public: {
    Tables: {
      property_intelligence_documents: {
        Row: Document & {
          org_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      property_intelligence_changes: {
        Row: {
          id: string;
          property_id: string;
          actor_id: string;
          input: unknown;
          before_value: unknown;
          after_value: unknown;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
export const intelligenceDb = () =>
  createServiceClient() as unknown as SupabaseClient<Domain>;
export async function intelligenceActor(propertyId: string, manage = false) {
  const {
    data: { user },
    error,
  } = await (await createClient()).auth.getUser();
  if (error || !user) throw new IntelligenceError("Please sign in.", 401);
  const membership = await createServiceClient().rpc("team_member_view", {
    p_id: user.id,
  });
  if (
    membership.error ||
    !membership.data ||
    typeof membership.data !== "object" ||
    Array.isArray(membership.data) ||
    membership.data.accessBlocked !== false
  )
    throw new IntelligenceError("Workspace access is unavailable.", 403);
  const access = await (
    manage ? validatePropertyManagerAccess : validatePropertyAccess
  )(user.id, propertyId);
  if (!access.authorized)
    throw new IntelligenceError(
      "This property is not available to your account.",
      403,
    );
  return user.id;
}
export async function readDocuments(propertyId: string, kinds?: Kind[]) {
  let q = intelligenceDb()
    .from("property_intelligence_documents")
    .select("*")
    .eq("property_id", propertyId)
    .order("updated_at", { ascending: false })
    .limit(1001);
  if (kinds) q = q.in("kind", kinds);
  const r = await q;
  if (r.error)
    throw new IntelligenceError("Property intelligence could not be loaded.");
  if ((r.data?.length ?? 0) > 1000)
    throw new IntelligenceError(
      "This property exceeds the current workspace limit. Narrow the archive before continuing.",
      422,
    );
  return r.data ?? [];
}
export async function saveDocument(actor: string, input: Command) {
  const { requestId, propertyId, ...command } = input;
  if (command.operation === "save") {
    const parsed = payloadSchemas[command.kind].safeParse(command.payload);
    if (!parsed.success)
      throw new IntelligenceError(
        parsed.error.issues.map((i) => i.message).join(" "),
        400,
      );
    command.payload = parsed.data;
    if (
      command.kind === "fact" &&
      "field" in parsed.data &&
      command.key !== parsed.data.field
    )
      throw new IntelligenceError(
        "The fact identity does not match its field.",
        400,
      );
  }
  if (command.operation === "measure") {
    const docs = await readDocuments(propertyId);
    const doc = docs.find(
      (d) => d.kind === command.kind && d.key === command.key,
    );
    if (!doc) throw new IntelligenceError("Saved item not found.", 404);
    if (command.kind === "experiment") {
      const { evaluateExperiment, approvedObservations } =
        await import("./analysis");
      const result = evaluateExperiment(doc, approvedObservations(docs));
      if (!result.ready)
        throw new IntelligenceError(
          "Complete the registered period and minimum sample before recording a result.",
          409,
        );
      command.payload = { evaluation: result };
    } else if (command.kind === "recommendation") {
      const p = payloadSchemas.recommendation.parse(command.payload);
      if (!p.result.trim() || !p.measurementEvent)
        throw new IntelligenceError(
          "Describe the observed result and select its confirmed measurement action.",
          400,
        );
      command.payload = {
        result: p.result,
        measurementEvent: p.measurementEvent,
      };
    }
  }
  const rpc = createServiceClient() as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: {
        state: string;
        document: Document;
      } | null;
      error: unknown;
    }>;
  };
  const r = await rpc.rpc("decide_property_intelligence", {
    p_id: requestId,
    p_actor_id: actor,
    p_property_id: propertyId,
    p_input: command,
  });
  if (r.error || !r.data)
    throw new IntelligenceError(
      "The save could not be confirmed. Retry the same request to retrieve its result.",
    );
  const messages: Record<string, string> = {
    changed: "This item changed. Refresh before saving.",
    locked: "Unlock this approved fact before editing it.",
    frozen:
      "This approved experiment or completed recommendation is frozen. Create a new version.",
    forbidden: "Manager access is required.",
    request_conflict: "This request already belongs to another decision.",
    preregister_required:
      "Register the experiment before its measurement period begins.",
    invalid_evidence: "Select a confirmed action from this property.",
    invalid_transition: "This item is not at the required review step.",
  };
  if (!["saved", "replayed"].includes(r.data.state))
    throw new IntelligenceError(
      messages[r.data.state] ?? "Review the required fields.",
      r.data.state === "forbidden" ? 403 : 409,
    );
  return r.data;
}
export async function canonicalInformation(
  propertyId: string,
  audience: "public" | "portal" = "public",
) {
  const docs = await readDocuments(propertyId, ["fact", "creative"]);
  const facts = docs.filter(
    (d) => d.kind === "fact" && factUsable(d, audience),
  );
  const creative =
    docs.find((d) => d.kind === "creative" && d.status === "approved") ?? null;
  return {
    facts: facts.map((d) => ({
      id: d.id,
      revision: d.revision,
      ...payloadSchemas.fact.parse(d.payload),
      locked: d.locked,
    })),
    creative: audience === "public" ? creative : null,
    excludedFacts: docs.filter(
      (d) => d.kind === "fact" && !factUsable(d, audience),
    ).length,
  };
}
