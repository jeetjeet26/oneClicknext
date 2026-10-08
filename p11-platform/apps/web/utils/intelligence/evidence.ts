// A confirmed record is not automatically proof of an external deployment or signature.
export const releaseActions = [
  "site.delivery.recorded",
  "site.delivery.reviewed",
  "knowledge.source.published",
  "knowledge.facts.published",
  "property.setup.saved",
  "property.unit.approved",
  "luma.configuration.saved",
  "crm.mapping.approved",
  "studio.configuration.saved",
  "review.publication.reported",
  "integration.account.replaced",
  "pipeline.import.finished",
] as const;
export const measurementActions = [
  "bi.query.executed",
  "delivery.outcomes",
  "tour.outcome.recorded",
  "studio.metrics.reviewed",
  "studio.attribution.reviewed",
  "audit.run_reviewed",
] as const;
export function evidencePurpose(
  action: string,
): "release" | "measurement" | null {
  if ((releaseActions as readonly string[]).includes(action)) return "release";
  if ((measurementActions as readonly string[]).includes(action))
    return "measurement";
  return null;
}
