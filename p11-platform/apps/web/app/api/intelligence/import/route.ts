import { requireTeamOrigin, teamBody } from "@/utils/team/http";
import { InventoryError } from "@/utils/knowledge/inventory";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  intelligenceActor,
  IntelligenceError,
} from "@/utils/intelligence/store";
import { parseObservationCsv } from "@/utils/intelligence/import";
export async function POST(req: NextRequest) {
  try {
    requireTeamOrigin(req);
    const input = z
      .object({
        propertyId: z.string().uuid(),
        source: z.string().min(1).max(200),
        account: z.string().min(1).max(200),
        content: z.string(),
      })
      .strict()
      .parse(await teamBody(req, 2000000));
    await intelligenceActor(input.propertyId, true);
    return NextResponse.json(
      {
        preview: parseObservationCsv(
          input.content,
          input.source,
          input.account,
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "The import could not be read.",
      },
      {
        status:
          e instanceof IntelligenceError || e instanceof InventoryError
            ? e.status
            : 400,
      },
    );
  }
}
