import "server-only";
import { createServiceClient } from "@/utils/supabase/admin";
import { portalActor, PortalError } from "@/utils/client-portal/server";
export { portalActor as deliveryActor, PortalError as DeliveryError };
const messages: Record<string, string> = {
  forbidden: "This account cannot manage this property.",
  changed: "This item changed. Refresh and review the latest version.",
  request_conflict:
    "This request already belongs to another decision. Check its saved result.",
  invalid_lead:
    "Check that each lead belongs to this property and each date falls between their inquiry and today.",
  duplicate_outcome:
    "An outcome already exists for this lead and stage. Correct the existing record instead of adding another.",
  reason_required: "Explain why this outcome is being corrected.",
  invalid_evidence:
    "Choose matching saved evidence from this property, recorded after the preceding review.",
  baseline_required:
    "Choose a saved PropertyAudit observation for the website baseline.",
  closed_work:
    "This work has already progressed. Create follow-up work for a further change.",
  invalid_transition:
    "This item is no longer at the expected step. Refresh and review it.",
  proposal_required:
    "Describe the proposal and success measure before requesting review.",
  published_report: "Withdraw the published report before revising it.",
  approval_expired:
    "The approving team member no longer has access. Withdraw and review this report again.",
  summary_required: "Add the client summary and next steps before approving.",
  incomplete_month: "Choose a completed month within the last two years.",
  not_found: "This item is not available in this property.",
  invalid_input: "Review the required fields and dates.",
};
export async function deliveryRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (
    createServiceClient() as unknown as {
      rpc: (
        n: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
    }
  ).rpc(name, args);
  if (error || !data)
    throw new PortalError(
      "The saved result could not be confirmed. Check this request before retrying.",
      503,
    );
  if (
    !["ready", "saved", "replayed", "not_recorded"].includes(String(data.state))
  )
    throw new PortalError(
      messages[String(data.state)] || "This request could not be completed.",
      data.state === "forbidden" ? 403 : 409,
    );
  if (args.p_property_id && data.propertyId !== args.p_property_id)
    throw new PortalError("The response does not match this property.", 503);
  if (args.p_id && data.id !== args.p_id)
    throw new PortalError("The response does not match this request.", 503);
  return data;
}
