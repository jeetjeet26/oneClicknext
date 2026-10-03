import { NextResponse } from "next/server";
import { deliveryCommand, deliveryQuery } from "@/utils/delivery/contracts";
import {
  deliveryActor,
  deliveryRpc,
  DeliveryError,
} from "@/utils/delivery/server";
import {
  teamBody,
  requireTeamOrigin,
  teamHeaders as headers,
} from "@/utils/team/http";
export const runtime = "nodejs";
function failure(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof DeliveryError
          ? e.message
          : "Reports and results are unavailable. Check the saved result before retrying.",
    },
    { status: e instanceof DeliveryError ? e.status : 503, headers },
  );
}
export async function GET(req: Request) {
  try {
    const q = deliveryQuery.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!q.success)
      throw new DeliveryError("Choose valid property filters.", 400);
    const actor = await deliveryActor(),
      { propertyId, receiptId, reportId, ...input } = q.data;
    const result = reportId
      ? await deliveryRpc("read_delivery_report", {
          p_actor_id: actor.id,
          p_property_id: propertyId,
          p_report_id: reportId,
        })
      : receiptId
        ? await deliveryRpc("read_delivery_receipt", {
            p_actor_id: actor.id,
            p_property_id: propertyId,
            p_id: receiptId,
          })
        : await deliveryRpc("read_delivery_workspace", {
            p_actor_id: actor.id,
            p_property_id: propertyId,
            p_input: input,
          });
    return NextResponse.json(
      {
        ...result,
        actorId: actor.id,
        draftAutomationAvailable:
          process.env.CLIENT_REPORT_DRAFTS_ENABLED === "true",
      },
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    requireTeamOrigin(req);
    const parsed = deliveryCommand.safeParse(await teamBody(req, 131072));
    if (!parsed.success)
      throw new DeliveryError("Review the required fields before saving.", 400);
    const c = parsed.data,
      actor = await deliveryActor();
    if (actor.id !== c.expectedActorId)
      throw new DeliveryError(
        "Your account changed. Reload before saving.",
        409,
      );
    // Keep historic records and request recovery available, but retire the
    // manual project-management commands, including forms in older open tabs.
    if (
      ["work_save", "work_transition", "quality_review"].includes(
        c.input.operation,
      )
    )
      throw new DeliveryError(
        "Project work is managed in Basecamp. Reload to view client reports and leasing outcomes.",
        410,
      );
    return NextResponse.json(
      await deliveryRpc("decide_delivery", {
        p_id: c.requestId,
        p_actor_id: actor.id,
        p_property_id: c.propertyId,
        p_input: c.input,
      }),
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}
