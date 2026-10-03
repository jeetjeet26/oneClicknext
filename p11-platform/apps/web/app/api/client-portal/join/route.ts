import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  portalActor,
  portalRpc,
  tokenHash,
  PortalError,
} from "@/utils/client-portal/server";
import {
  teamBody,
  requireTeamOrigin,
  teamHeaders as headers,
} from "@/utils/team/http";
export const runtime = "nodejs";
async function run(accept: boolean, id: string) {
  const user = await portalActor(),
    token = (await cookies()).get("p11_client_invitation")?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new PortalError(
      "Please open the invitation link from your P11 team again.",
      400,
    );
  return portalRpc("join_client_portal", {
    p_id: id,
    p_actor_id: user.id,
    p_token_hash: tokenHash(token),
    p_accept: accept,
  });
}
function fail(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof PortalError
          ? e.message
          : "Your invitation could not be confirmed.",
    },
    { status: e instanceof PortalError ? e.status : 503, headers },
  );
}
export async function GET() {
  try {
    return NextResponse.json(await run(false, crypto.randomUUID()), {
      headers,
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    requireTeamOrigin(req);
    const q = z
      .object({ requestId: z.string().uuid(), confirmed: z.literal(true) })
      .strict()
      .safeParse(await teamBody(req, 2048));
    if (!q.success)
      throw new PortalError("Review your invitation before continuing.", 400);
    return NextResponse.json(await run(true, q.data.requestId), { headers });
  } catch (e) {
    return fail(e);
  }
}
