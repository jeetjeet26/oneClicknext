import { NextResponse } from "next/server";
import { portalActor, PortalError } from "@/utils/client-portal/server";
import { clientConversationQuery } from "@/utils/client-portal/conversation-contracts";
import { readClientConversations } from "@/utils/client-portal/conversations";

export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(req: Request) {
  try {
    const user = await portalActor();
    const query = clientConversationQuery.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!query.success)
      throw new PortalError(
        "Choose a valid property and conversation page.",
        400,
      );
    return NextResponse.json(
      await readClientConversations(user.id, query.data),
      { headers },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof PortalError
            ? e.message
            : "Conversations are temporarily unavailable. Please try again.",
      },
      { status: e instanceof PortalError ? e.status : 503, headers },
    );
  }
}
