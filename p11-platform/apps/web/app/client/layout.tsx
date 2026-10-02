import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const db = await createClient(),
    {
      data: { user },
      error,
    } = await db.auth.getUser();
  if (error || !user) redirect("/auth/login?redirect=%2Fclient");
  const identity = await db.rpc("client_portal_identity");
  if (identity.error)
    throw new Error("Your account could not be loaded. Please try again.");
  if (
    !identity.data ||
    typeof identity.data !== "object" ||
    Array.isArray(identity.data) ||
    identity.data.kind !== "client"
  )
    redirect("/dashboard");
  return children;
}
