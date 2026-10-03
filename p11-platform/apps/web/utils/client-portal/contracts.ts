import type { BiReport } from "@/utils/analytics/report-data";
import type { Funnel, Goal, ReportEvidence } from "@/utils/delivery/contracts";
import { z } from "zod";
export const id = z.string().uuid();
export const portalQuery = z
  .object({
    propertyId: id.optional(),
    days: z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .default(30),
    reportOffset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
const properties = z
  .array(id)
  .min(1)
  .max(100)
  .refine((p) => new Set(p).size === p.length);
export const accessCommand = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("invite"),
      requestId: id,
      name: z.string().trim().min(1).max(120),
      email: z
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
      propertyIds: properties,
    })
    .strict(),
  z
    .object({
      operation: z.literal("update"),
      requestId: id,
      targetId: id,
      revision: z.number().int().positive(),
      propertyIds: properties,
    })
    .strict(),
  z
    .object({
      operation: z.literal("revoke"),
      requestId: id,
      targetId: id,
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("revoke_invitation"),
      requestId: id,
      targetId: id,
    })
    .strict(),
]);
export type PortalProperty = {
  id: string;
  name: string;
  address: {
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
};
export type PortalScope = {
  state: "ready";
  name: string;
  orgId: string;
  revision: number;
  properties: PortalProperty[];
};
export type Totals = {
  spend: number | null;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
};
export type ClientReport = {
  id: string;
  name: string;
  propertyName: string;
  createdAt: string;
  start: string;
  end: string;
  totals: Totals;
  records: number;
  summary: string;
  nextSteps: string;
  evidence: ReportEvidence;
  comparison: BiReport["comparison"];
  coverage: Omit<BiReport["coverage"], "sources"> & {
    sources: Omit<BiReport["coverage"]["sources"][number], "account">[];
  };
};
export type PortalData = {
  name: string;
  hasLumaLeasing: boolean;
  properties: PortalProperty[];
  selectedProperty: string | null;
  period: { start: string; end: string; days: number };
  inquiries: number;
  tours: number;
  marketing: Totals;
  hasMarketingData: boolean;
  channels: ({ channel: string } & Totals)[];
  trend: {
    date: string;
    impressions: number;
    clicks: number;
    spend: number | null;
  }[];
  reports: ClientReport[];
  nextReportOffset: number | null;
  updatedAt: string;
  funnel: Funnel;
  previousFunnel: Funnel;
  comparison: BiReport["comparison"];
  coverage: {
    propertyId: string;
    propertyName: string;
    observedDays: number;
    requestedDays: number;
    latestDate: string | null;
    records: number;
  }[];
  goals: (Goal & { propertyName: string })[];
};
export type AccessAccount = {
  id: string;
  name: string;
  email: string;
  status: "active" | "revoked";
  revision: number;
  properties: string[];
};
export type AccessInvitation = {
  id: string;
  name: string;
  email: string;
  status: string;
  properties: string[];
  expiresAt: string;
};
export type AccessRoster = {
  state: "ready";
  orgId: string;
  canManage: boolean;
  properties: { id: string; name: string }[];
  accounts: AccessAccount[];
  invitations: AccessInvitation[];
};
