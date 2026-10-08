import { describe, it, expect } from "vitest";
import { evidencePurpose } from "./evidence";
describe("action-to-outcome evidence", () => {
  it("never treats preparation or package generation as a live implementation", () => {
    for (const action of [
      "site.package.queued",
      "site.package.generating",
      "site.package.ready",
      "site.package.download_prepared",
      "intelligence.recommendation.approve",
    ])
      expect(evidencePurpose(action)).toBeNull();
  });
  it("separates recorded implementation sources from measurement sources", () => {
    expect(evidencePurpose("site.delivery.recorded")).toBe("release");
    expect(evidencePurpose("bi.query.executed")).toBe("measurement");
    expect(evidencePurpose("studio.metrics.reviewed")).toBe("measurement");
  });
});
