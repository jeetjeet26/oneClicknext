import { z } from "zod";
const id = z.string().uuid();
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Use a real calendar date.",
  );
const revision = z.number().int().positive();
export const products = {
  siteforge: "SiteForge",
  propertyaudit: "PropertyAudit",
  bi: "MultiChannel BI",
  tourspark: "TourSpark",
  lumaleasing: "LumaLeasing",
  leadpulse: "LeadPulse",
  crm: "CRM",
  forgestudio: "ForgeStudio",
  reviewflow: "ReviewFlow",
  marketvision: "MarketVision",
  brandforge: "BrandForge",
  property: "Property",
  knowledge: "Knowledge",
} as const;
export const stages = {
  booked: "Tour booked",
  attended: "Tour attended",
  application: "Application received",
  lease: "Lease signed",
} as const;
export const workStatuses = {
  draft: "In preparation",
  review: "Ready for review",
  approved: "Approved",
  released: "Release evidence recorded",
  measured: "Results reviewed",
  blocked: "Needs attention",
  cancelled: "Closed",
} as const;
export const playbooks = {
  custom: {
    label: "Custom work",
    product: "bi",
    title: "",
    proposal: "",
    next: "Describe the next action.",
  },
  website_improvement: {
    label: "Improve a website",
    product: "siteforge",
    title: "Website improvement",
    proposal:
      "Finding and baseline:\n\nProposed change:\n\nSuccess measure and follow-up date:\n\nRollback approach:",
    next: "Review the saved PropertyAudit finding and prepare a SiteForge brief.",
  },
  onboarding: {
    label: "Onboard a property",
    product: "property",
    title: "Property onboarding",
    proposal:
      "Confirm property facts, brand materials, contacts, integrations and client access. Record gaps and validate a full client journey before handoff.",
    next: "Review property facts and assign missing information.",
  },
  monthly_review: {
    label: "Monthly performance review",
    product: "bi",
    title: "Monthly performance review",
    proposal:
      "Review source freshness, marketing performance, inquiry outcomes and completed work. Agree priorities and publish the reviewed client report.",
    next: "Confirm source coverage and reconcile reported outcomes.",
  },
  rebrand: {
    label: "Property rebrand",
    product: "brandforge",
    title: "Property rebrand",
    proposal:
      "Confirm research, positioning, approved brand materials, website changes and launch checks. Retain the client-facing summary and measure results.",
    next: "Review the approved brand brief and outstanding decisions.",
  },
} as const;
export const outcomeRow = z
  .object({
    leadId: id,
    stage: z.enum(["booked", "attended", "application", "lease"]),
    occurredOn: calendarDate,
    source: z.enum(["staff_reported", "reviewed_import"]),
    reference: z.string().trim().min(3).max(500),
    revision: revision.nullable(),
    reason: z.string().trim().max(1000),
  })
  .strict();
const assessment = z
  .object({
    model: z.string().trim().min(1).max(120),
    factual: z.boolean(),
    brand: z.boolean(),
    complete: z.boolean(),
    score: z.number().int().min(1).max(5),
    corrections: z.string().trim().min(3).max(2000),
    baselineMinutes: z.number().min(0).max(100000).nullable(),
    deliveryMinutes: z.number().min(0).max(100000).nullable(),
    reviewMinutes: z.number().min(0).max(100000).nullable(),
    correctionMinutes: z.number().min(0).max(100000).nullable(),
    costUsd: z.number().min(0).max(100000).nullable(),
  })
  .strict();
export const deliveryInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("cancel_request") }).strict(),
  z
    .object({ operation: z.literal("report_refresh"), targetId: id, revision })
    .strict(),
  z
    .object({
      operation: z.literal("outcomes"),
      rows: z
        .array(outcomeRow)
        .min(1)
        .max(100)
        .refine(
          (rows) =>
            new Set(rows.map((r) => r.leadId + ":" + r.stage)).size ===
            rows.length,
          "A lead and stage may appear only once.",
        ),
    })
    .strict(),
  z
    .object({
      operation: z.literal("outcome_withdraw"),
      targetId: id,
      revision,
      reason: z.string().trim().min(3).max(1000),
    })
    .strict(),
  z
    .object({
      operation: z.literal("work_save"),
      targetId: id.nullable(),
      revision: revision.nullable(),
      title: z.string().trim().min(3).max(160),
      product: z.enum(
        Object.keys(products) as [
          keyof typeof products,
          ...(keyof typeof products)[],
        ],
      ),
      playbook: z.enum(
        Object.keys(playbooks) as [
          keyof typeof playbooks,
          ...(keyof typeof playbooks)[],
        ],
      ),
      ownerId: id,
      dueOn: calendarDate,
      nextStep: z.string().trim().min(3).max(1000),
      proposal: z.string().max(4000),
      clientSummary: z.string().max(2000),
      baselineEvent: id.nullable(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("work_transition"),
      targetId: id,
      revision,
      status: z.enum([
        "draft",
        "review",
        "approved",
        "released",
        "measured",
        "blocked",
        "cancelled",
      ]),
      nextStep: z.string().trim().min(3).max(1000),
      evidenceId: id.nullable(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("quality_review"),
      targetId: id,
      revision,
      evidenceId: id,
      assessment,
    })
    .strict(),
  z
    .object({
      operation: z.literal("report_draft"),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    })
    .strict(),
  z
    .object({
      operation: z.literal("report_edit"),
      targetId: id,
      revision,
      summary: z.string().trim().min(10).max(4000),
      nextSteps: z.string().trim().min(3).max(2000),
    })
    .strict(),
  z
    .object({
      operation: z.literal("report_transition"),
      targetId: id,
      revision,
      status: z.enum(["approved", "published", "withdrawn"]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("report_policy"),
      revision: revision.nullable(),
      enabled: z.boolean(),
    })
    .strict(),
]);
export const deliveryCommand = z
  .object({
    requestId: id,
    expectedActorId: id,
    propertyId: id,
    input: deliveryInput,
  })
  .strict();
export const deliveryQuery = z
  .object({
    propertyId: id,
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    search: z.string().max(100).default(""),
    start: calendarDate.optional(),
    end: calendarDate.optional(),
    receiptId: id.optional(),
    reportId: id.optional(),
  })
  .strict();
export type DeliveryInput = z.infer<typeof deliveryInput>;
export type DeliveryCommand = z.infer<typeof deliveryCommand>;
export type OutcomeInput = z.infer<typeof outcomeRow>;
export type Assessment = z.infer<typeof assessment>;
export type Funnel = {
  definition: "inquiry-cohort-v1";
  start: string;
  end: string;
  inquiries: number;
  booked: number;
  attended: number;
  applications: number;
  leases: number;
  sources: ({ source: string } & Pick<
    Funnel,
    "inquiries" | "booked" | "attended" | "applications" | "leases"
  >)[];
  reportedRecords: number;
  lastOutcomeUpdate: string | null;
  limitations: string;
};
export type Evidence = {
  id: string;
  product: string;
  action: string;
  created_at: string;
};
export type WorkItem = {
  id: string;
  title: string;
  product: keyof typeof products;
  playbook: keyof typeof playbooks;
  owner_id: string;
  due_on: string;
  status: keyof typeof workStatuses;
  next_step: string;
  proposal: string;
  client_summary: string;
  baseline_event: string | null;
  release_event: string | null;
  measurement_event: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type Outcome = {
  id: string;
  lead_id: string;
  lead_name: string;
  stage: keyof typeof stages;
  occurred_on: string;
  source: string;
  reference: string;
  state: "active" | "withdrawn";
  revision: number;
  updated_at: string;
};
export type Goal = {
  metric: string;
  target: number;
  type: string;
  inverse: boolean;
};
export type ReportEvidence = {
  funnel: Funnel;
  previousFunnel: Funnel;
  goals: Goal[];
  completedWork: {
    id: string;
    title: string;
    summary: string;
    completedAt: string;
  }[];
  capturedAt: string;
};
export type DeliveryReport = {
  id: string;
  month: string;
  state: "draft" | "approved" | "published" | "withdrawn";
  summary: string;
  next_steps: string;
  evidence: ReportEvidence;
  revision: number;
  published_at: string | null;
};
export type Quality = {
  id: string;
  work_id: string;
  work_revision: number;
  title: string;
  evidence_id: string;
  assessment: Assessment;
  created_at: string;
};
export type Workspace = {
  state: "ready";
  actorId: string;
  propertyId: string;
  canManage: boolean;
  offset: number;
  funnel: Funnel;
  previousFunnel: Funnel;
  members: { id: string; name: string }[];
  leads: { id: string; name: string; source: string; created_at: string }[];
  work: WorkItem[];
  workTotal: number;
  workSummary: {
    open: number;
    overdue: number;
    needsReview: number;
    blocked: number;
  };
  outcomes: Outcome[];
  outcomeTotal: number;
  reports: DeliveryReport[];
  reportTotal: number;
  quality: Quality[];
  qualityTotal: number;
  evidenceTotal: number;
  evidence: Evidence[];
  policy: { enabled: boolean; revision: number } | null;
  history: {
    id: string;
    operation: string;
    result: Record<string, unknown>;
    created_at: string;
  }[];
  historyTotal: number;
};
export const destinations: Record<keyof typeof products, string> = {
  siteforge: "/dashboard/siteforge",
  propertyaudit: "/dashboard/propertyaudit",
  bi: "/dashboard/bi",
  tourspark: "/dashboard/leads",
  lumaleasing: "/dashboard/lumaleasing",
  leadpulse: "/dashboard/leadpulse",
  crm: "/dashboard/settings?tab=integrations",
  forgestudio: "/dashboard/forgestudio",
  reviewflow: "/dashboard/reviewflow",
  marketvision: "/dashboard/marketvision",
  brandforge: "/dashboard/brandforge",
  property: "/dashboard/community",
  knowledge: "/dashboard/community",
};
