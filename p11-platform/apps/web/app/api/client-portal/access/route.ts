import { NextResponse } from "next/server";
import {
  portalActor,
  portalRpc,
  decideAccess,
  PortalError,
} from "@/utils/client-portal/server";
import { accessCommand } from "@/utils/client-portal/contracts";
import {
  teamBody,
  requireTeamOrigin,
  teamHeaders as headers,
} from "@/utils/team/http";
export const runtime = "nodejs";
function fail(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof PortalError
          ? e.message
          : "Client access is temporarily unavailable.",
    },
    { status: e instanceof PortalError ? e.status : 503, headers },
  );
}
export async function GET() {
  try {
    const user = await portalActor();
    return NextResponse.json(
      await portalRpc("read_client_access", { p_actor_id: user.id }),
      { headers },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    requireTeamOrigin(req);
    const command = accessCommand.safeParse(await teamBody(req));
    if (!command.success)
      throw new PortalError(
        "Review the client name, email and assigned properties.",
        400,
      );
    const user = await portalActor();
    return NextResponse.json(await decideAccess(user.id, command.data), {
      headers,
    });
  } catch (e) {
    return fail(e);
  }
}
