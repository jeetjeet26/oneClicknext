import { NextResponse } from "next/server";
import {
  portalActor,
  readPortal,
  PortalError,
} from "@/utils/client-portal/server";
import { portalQuery } from "@/utils/client-portal/contracts";
export const runtime = "nodejs";
export const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export async function GET(req: Request) {
  try {
    const parsed = portalQuery.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success)
      throw new PortalError("Choose a property and reporting period.", 400);
    const user = await portalActor();
    return NextResponse.json(await readPortal(user.id, parsed.data), {
      headers,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof PortalError
            ? e.message
            : "Your results are temporarily unavailable. Please try again.",
      },
      { status: e instanceof PortalError ? e.status : 503, headers },
    );
  }
}
