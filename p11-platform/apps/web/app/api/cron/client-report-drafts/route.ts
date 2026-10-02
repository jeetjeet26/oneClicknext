import { NextResponse } from "next/server";
import { validateCronAuth } from "@/utils/services/api-helpers";
import {
  startCronJobRun,
  finishCronJobRun,
} from "@/utils/services/cron-job-runs";
import { deliveryRpc } from "@/utils/delivery/server";
import { teamHeaders as headers } from "@/utils/team/http";
export const runtime = "nodejs";
async function prepare(request: Request) {
  const invalid = validateCronAuth(request);
  if (invalid) return invalid;
  if (process.env.CLIENT_REPORT_DRAFTS_ENABLED !== "true")
    return NextResponse.json({ state: "disabled" }, { headers });
  const run = await startCronJobRun({ jobName: "client-report-drafts" });
  if (!run)
    return NextResponse.json(
      { error: "The draft preparation run could not be recorded." },
      { status: 503, headers },
    );
  try {
    const result = await deliveryRpc("draft_due_client_reports", {
      p_limit: 10,
    });
    const rows = result.results as {
      propertyId: string;
      result: { state: string };
    }[];
    const failed = rows.filter(
      (r) => !["saved", "replayed"].includes(r.result.state),
    ).length;
    const confirmed = await finishCronJobRun(run, {
      status: failed ? "partial" : "success",
      summary: {
        prepared: rows.length - failed,
        failed,
        publication: "staff_review_required",
      },
    });
    if (!confirmed)
      return NextResponse.json(
        {
          error:
            "Drafts may have been saved, but run completion could not be confirmed. Check report history.",
        },
        { status: 503, headers },
      );
    return NextResponse.json(result, { headers });
  } catch {
    await finishCronJobRun(run, {
      status: "failed",
      error: "Monthly draft results could not be confirmed.",
    });
    return NextResponse.json(
      {
        error:
          "Monthly drafts could not be confirmed. Check the delivery workspace before retrying.",
      },
      { status: 503, headers },
    );
  }
}
export const POST = prepare;
export const GET = prepare;
