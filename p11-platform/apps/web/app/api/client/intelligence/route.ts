import { InventoryError } from "@/utils/knowledge/inventory";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dateRange } from "@/utils/intelligence/contracts";
import { readPortfolio } from "@/utils/intelligence/portfolio";
import { answerPortfolioQuestion } from "@/utils/intelligence/questions";
import { IntelligenceError } from "@/utils/intelligence/store";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const range = dateRange.parse({ start: p.get("start"), end: p.get("end") });
    const id = z
      .string()
      .uuid()
      .optional()
      .parse(p.get("propertyId") ?? undefined);
    const data = await readPortfolio(range.start, range.end, true, id);
    return reply(
      p.has("question")
        ? answerPortfolioQuestion(p.get("question")!, data)
        : data,
    );
  } catch (e) {
    return reply(
      {
        error:
          e instanceof IntelligenceError || e instanceof InventoryError
            ? e.message
            : "These insights could not be loaded.",
      },
      e instanceof IntelligenceError || e instanceof InventoryError
        ? e.status
        : e instanceof z.ZodError
          ? 400
          : 503,
    );
  }
}
