import { NextResponse } from "next/server";
import { z } from "zod";
import {
  teamBody,
  requireTeamOrigin,
  teamHeaders as headers,
} from "@/utils/team/http";
import { PortalError } from "@/utils/client-portal/server";
export async function POST(req: Request) {
  try {
    requireTeamOrigin(req);
    const q = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .safeParse(await teamBody(req, 2048));
    if (!q.success)
      throw new PortalError("This invitation link is invalid.", 400);
    const response = NextResponse.json({ state: "ready" }, { headers });
    response.cookies.set("p11_client_invitation", q.data.token, {
      httpOnly: true,
      secure: new URL(req.url).protocol === "https:",
      sameSite: "lax",
      path: "/api/client-portal/join",
      maxAge: 1800,
    });
    return response;
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof PortalError
            ? e.message
            : "This invitation could not be opened.",
      },
      { status: e instanceof PortalError ? e.status : 503, headers },
    );
  }
}
