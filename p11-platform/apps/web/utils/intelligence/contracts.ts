import { z } from "zod";
import { calendarDate } from "@/utils/delivery/contracts";
const text = z.string().trim().max(8000);
const label = z.string().trim().min(1).max(200);
const url = z
  .string()
  .url()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  });
export const fieldRegistry = {
  lifecycle_stage: ["Lifecycle stage", "Identity"],
  market: ["Market", "Identity"],
  submarket: ["Submarket", "Identity"],
  ownership_entity: ["Owner / developer", "Identity"],
  management_company: ["Management company", "Identity"],
  short_description: ["Short description", "Positioning"],
  long_description: ["Property story", "Positioning"],
  value_proposition: ["Value proposition", "Positioning"],
  audience_segments: ["Audience segments", "Positioning"],
  differentiators: ["Differentiators", "Positioning"],
  messaging_pillars: ["Messaging pillars", "Positioning"],
  proof_points: ["Supporting facts", "Positioning"],
  restricted_claims: ["Claims to avoid", "Positioning"],
  neighborhood_name: ["Neighborhood", "Location"],
  location_story: ["Location story", "Location"],
  employers: ["Nearby employers", "Location"],
  schools: ["School information", "Location"],
  transit: ["Transit and access", "Location"],
  fees: ["Fees", "Product"],
  concessions: ["Concessions", "Product"],
  amenities_detail: ["Amenity details", "Product"],
  features_detail: ["Feature details", "Product"],
  pet_policy_detail: ["Pet policy", "Product"],
  parking_detail: ["Parking policy", "Product"],
  primary_cta: ["Primary call to action", "Conversion"],
  tour_url: ["Tour scheduling link", "Conversion"],
  application_url: ["Application link", "Conversion"],
  public_phone: ["Public contact phone", "Conversion"],
  public_email: ["Public contact email", "Conversion"],
  forms: ["Forms and consent", "Conversion"],
  tracking_numbers: ["Tracking numbers", "Conversion"],
  content_blocks: ["Reusable stories", "Content"],
  faqs: ["Frequently asked questions", "Content"],
  offers: ["Offers and terms", "Content"],
  events: ["Community events", "Content"],
  virtual_tours: ["Virtual tours", "Content"],
  canonical_name: ["Canonical name", "Discovery"],
  entity_aliases: ["Other property names", "Discovery"],
  structured_facts: ["Structured facts", "Discovery"],
  schema_org_types: ["Entity types", "Discovery"],
  seo_metadata: ["Search titles and descriptions", "Discovery"],
  geo_answers: ["Answer-ready facts", "Discovery"],
  source_urls: ["Authoritative references", "Discovery"],
} as const;
export const factSchema = z
  .object({
    field: z.enum(
      Object.keys(fieldRegistry) as [
        keyof typeof fieldRegistry,
        ...(keyof typeof fieldRegistry)[],
      ],
    ),
    value: text.min(1),
    source: label,
    sourceUrl: url.or(z.literal("")),
    observedAt: calendarDate,
    effectiveFrom: calendarDate.nullable(),
    effectiveTo: calendarDate.nullable(),
    reviewAfter: calendarDate,
    confidence: z.number().min(0).max(1).nullable(),
    origin: z.enum(["staff", "client", "import", "ai_suggested"]),
    visibility: z.enum(["public", "portal", "internal"]),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.effectiveFrom && v.effectiveTo && v.effectiveFrom > v.effectiveTo)
      c.addIssue({ code: "custom", message: "Effective dates are reversed." });
    if (v.reviewAfter < v.observedAt)
      c.addIssue({
        code: "custom",
        message: "Review date must follow the observation.",
      });
    if (
      ["tour_url", "application_url"].includes(v.field) &&
      !url.safeParse(v.value).success
    )
      c.addIssue({ code: "custom", message: "Use a full website address." });
    if (v.field === "public_email" && !z.email().safeParse(v.value).success)
      c.addIssue({ code: "custom", message: "Use a valid email." });
  });
export const creativeSchema = z
  .object({
    title: label,
    thesis: text.min(3),
    references: z.array(url).max(20),
    typography: text,
    palette: text,
    imagery: text,
    spacing: text,
    motion: text,
    hero: text,
    pageRhythm: text,
    voice: text,
    exceptions: text,
    componentKeys: z
      .array(z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/))
      .max(30),
  })
  .strict();
export const metricKeys = [
  "sessions",
  "engaged_sessions",
  "floorplan_views",
  "tour_starts",
  "tour_completions",
  "form_starts",
  "form_completions",
  "search_impressions",
  "search_clicks",
  "calls",
  "answered_calls",
  "qualified_calls",
  "available_units",
  "market_rent",
  "active_leases",
  "applications",
  "signed_leases",
] as const;
export const observationSchema = z
  .object({
    key: label,
    date: calendarDate,
    metric: z.enum(metricKeys),
    value: z.number().finite().min(0),
    channel: z.string().max(100).default("unknown"),
    device: z
      .enum(["all", "desktop", "mobile", "tablet", "unknown"])
      .default("all"),
    floorplanId: z.string().max(100).nullable().default(null),
    page: z.string().max(500).nullable().default(null),
    variant: z.enum(["control", "treatment"]).nullable().default(null),
    experimentId: z.string().uuid().nullable().default(null),
    reference: z.string().max(500).default(""),
  })
  .strict();
export const batchSchema = z
  .object({
    provider: z.enum([
      "search_console",
      "callrail",
      "buildium",
      "reviewed_import",
    ]),
    account: label,
    source: label,
    start: calendarDate,
    end: calendarDate,
    observedAt: z.iso.datetime(),
    limitations: z.array(z.string().max(1000)).max(20),
    rows: z.array(observationSchema).max(5000),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.start > v.end)
      c.addIssue({ code: "custom", message: "Dates are reversed." });
    if (v.rows.some((r) => r.date < v.start || r.date > v.end))
      c.addIssue({
        code: "custom",
        message: "A row falls outside the reporting window.",
      });
    if (new Set(v.rows.map((r) => r.key)).size !== v.rows.length)
      c.addIssue({
        code: "custom",
        message: "Source row identities must be unique.",
      });
  });
export const recommendationSchema = z
  .object({
    title: label,
    rationale: text.min(3),
    targetMetric: label,
    owner: label,
    executionType: z.enum([
      "website",
      "media",
      "content",
      "search",
      "data",
      "operations",
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z
      .array(
        z.object({ label, reference: label, observedAt: z.iso.datetime() }),
      )
      .min(1)
      .max(30),
    basecampUrl: url.or(z.literal("")),
    expectedImpact: text,
    rollback: text,
    result: text,
    releaseEvent: z.string().uuid().nullable(),
    measurementEvent: z.string().uuid().nullable().default(null),
  })
  .strict();
export const experimentSchema = z
  .object({
    title: label,
    hypothesis: text.min(3),
    metric: z.enum(["tour_completions", "form_completions"]),
    denominator: z.literal("sessions"),
    assignment: z.literal("randomized"),
    assignmentReference: text.min(3),
    start: calendarDate,
    end: calendarDate,
    minimumPerArm: z.number().int().min(30).max(1000000),
    minimumEffect: z.number().min(0).max(1),
    guardrail: text.min(3),
    releaseEvent: z.string().uuid(),
    confounders: text,
    notes: text,
  })
  .strict()
  .refine((v) => v.end > v.start, "Choose an end date after the start date.");
export const documentKinds = [
  "fact",
  "creative",
  "batch",
  "recommendation",
  "experiment",
] as const;
export type Kind = (typeof documentKinds)[number];
export type Document = {
  id: string;
  property_id: string;
  kind: Kind;
  key: string;
  payload: unknown;
  status:
    | "draft"
    | "approved"
    | "withdrawn"
    | "implemented"
    | "measured"
    | "dismissed";
  revision: number;
  locked: boolean;
  updated_at: string;
  actor_id: string;
};
export const payloadSchemas = {
  fact: factSchema,
  creative: creativeSchema,
  batch: batchSchema,
  recommendation: recommendationSchema,
  experiment: experimentSchema,
};
export const commandSchema = z
  .object({
    requestId: z.string().uuid(),
    propertyId: z.string().uuid(),
    kind: z.enum(documentKinds),
    key: z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/),
    expectedRevision: z.number().int().nonnegative(),
    operation: z.enum([
      "save",
      "approve",
      "withdraw",
      "lock",
      "unlock",
      "implement",
      "measure",
      "dismiss",
    ]),
    payload: z.unknown().optional(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export type Fact = z.infer<typeof factSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Experiment = z.infer<typeof experimentSchema>;
export const dateRange = z
  .object({ start: calendarDate, end: calendarDate })
  .refine(
    (v) =>
      v.start <= v.end &&
      (Date.parse(v.end) - Date.parse(v.start)) / 86400000 < 366,
    "Choose up to 366 days.",
  );
export function factUsable(
  doc: Document,
  audience: "public" | "portal",
  today = new Date().toISOString().slice(0, 10),
) {
  const p = factSchema.safeParse(doc.payload);
  return (
    p.success &&
    doc.status === "approved" &&
    p.data.visibility !== "internal" &&
    (audience === "portal" || p.data.visibility === "public") &&
    p.data.observedAt <= today &&
    p.data.reviewAfter >= today &&
    (!p.data.effectiveFrom || p.data.effectiveFrom <= today) &&
    (!p.data.effectiveTo || p.data.effectiveTo >= today)
  );
}
