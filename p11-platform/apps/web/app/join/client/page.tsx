import { createClient } from "@/utils/supabase/server";
import { ClientJoin } from "@/components/client-portal/ClientJoin";
export const metadata = {
  title: "Welcome to your P11 workspace",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default async function JoinClient() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return <ClientJoin actorId={user?.id ?? null} />;
}
