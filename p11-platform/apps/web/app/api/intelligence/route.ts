import {
  releaseActions,
  measurementActions,
  evidencePurpose,
} from "@/utils/intelligence/evidence";
import {
  ACTION_LABELS,
  PRODUCT_LABELS,
  type ProductKey,
} from "@/utils/actions/catalog";
import { requireTeamOrigin, teamBody } from "@/utils/team/http";
import { createServiceClient } from "@/utils/supabase/admin";
import { InventoryError } from "@/utils/knowledge/inventory";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  commandSchema,
  dateRange,
  batchSchema,
} from "@/utils/intelligence/contracts";
import {
  intelligenceActor,
  readDocuments,
  saveDocument,
  canonicalInformation,
  intelligenceDb,
  IntelligenceError,
} from "@/utils/intelligence/store";
import {
  connectionSummary,
  enabledProviders,
  providerBinding,
  retrieveProvider,
} from "@/utils/intelligence/providers";
import {
  componentGuides,
  publishingTargets,
  webflowCsv,
} from "@/utils/intelligence/components";
import { readPortfolio } from "@/utils/intelligence/portfolio";
import { answerPortfolioQuestion } from "@/utils/intelligence/questions";
export const maxDuration = 300;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const kind = p.get("kind") ?? "workspace";
    if (kind === "portfolio") {
      const range = dateRange.parse({
        start: p.get("start"),
        end: p.get("end"),
      });
      return reply(
        await readPortfolio(
          range.start,
          range.end,
          false,
          p.get("propertyId") ?? undefined,
        ),
      );
    }
    const id = z.string().uuid().parse(p.get("propertyId"));
    await intelligenceActor(id);
    if (kind === "webflow") {
      const info = await canonicalInformation(id);
      return new NextResponse(webflowCsv(info.facts), {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition":
            'attachment; filename="p11-webflow-approved-content.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    const [documents, history, events] = await Promise.all([
      readDocuments(id),
      intelligenceDb()
        .from("property_intelligence_changes")
        .select("id,actor_id,input,created_at")
        .eq("property_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      createServiceClient()
        .from("shared_action_events")
        .select("id,product,action,created_at")
        .eq("property_id", id)
        .eq("evidence", "server_confirmed")
        .eq("phase", "succeeded")
        .in("action", [...releaseActions, ...measurementActions])
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (history.error || events.error)
      throw new IntelligenceError("Change history could not be loaded.");
    let canManage = true;
    try {
      await intelligenceActor(id, true);
    } catch {
      canManage = false;
    }
    await intelligenceActor(id);
    return reply({
      documents,
      events: events.data?.map((e) => ({
        ...e,
        purpose: evidencePurpose(e.action),
        action: ACTION_LABELS[e.action] ?? "Recorded action",
        product: PRODUCT_LABELS[e.product as ProductKey] ?? "Console",
      })),
      history: history.data,
      connections: connectionSummary(id),
      componentGuides,
      publishingTargets,
      canManage,
    });
  } catch (e) {
    return reply(
      {
        error:
          e instanceof z.ZodError
            ? "Review the dates and property."
            : e instanceof IntelligenceError || e instanceof InventoryError
              ? e.message
              : "This view could not be loaded.",
      },
      e instanceof IntelligenceError || e instanceof InventoryError
        ? e.status
        : e instanceof z.ZodError
          ? 400
          : 503,
    );
  }
}
export async function POST(req: NextRequest) {
  try {
    requireTeamOrigin(req);
    const body = await teamBody(req, 2000000);
    if (body.action === "question") {
      const q = z
        .object({
          action: z.literal("question"),
          question: z.string().min(1).max(2000),
          start: z.string(),
          end: z.string(),
          propertyId: z.string().uuid().optional(),
        })
        .strict()
        .parse(body);
      const range = dateRange.parse(q);
      const data = await readPortfolio(
        range.start,
        range.end,
        false,
        q.propertyId,
      );
      return reply(answerPortfolioQuestion(q.question, data));
    }
    if (body.action === "retrieve") {
      const q = z
        .object({
          action: z.literal("retrieve"),
          propertyId: z.string().uuid(),
          provider: z.enum(enabledProviders),
          start: z.string(),
          end: z.string(),
        })
        .strict()
        .parse(body);
      await intelligenceActor(q.propertyId, true);
      const range = dateRange.parse(q);
      const config = providerBinding(q.propertyId, q.provider);
      if (!config)
        throw new IntelligenceError(
          "This source is not connected. Account activation is deferred.",
          409,
        );
      return reply({
        preview: batchSchema.parse(
          await retrieveProvider(config, range.start, range.end),
        ),
      });
    }
    const command = commandSchema.parse(body);
    const actor = await intelligenceActor(command.propertyId, true);
    return reply(await saveDocument(actor, command));
  } catch (e) {
    return reply(
      {
        error:
          e instanceof z.ZodError
            ? e.issues.map((i) => i.message).join(" ")
            : e instanceof IntelligenceError || e instanceof InventoryError
              ? e.message
              : "The request could not be confirmed. Keep your draft and retry.",
      },
      e instanceof IntelligenceError || e instanceof InventoryError
        ? e.status
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? 400
          : 503,
    );
  }
}
