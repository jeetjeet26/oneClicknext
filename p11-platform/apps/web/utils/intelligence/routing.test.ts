import { describe, it, expect } from "vitest";
import { clientApiAllowed } from "@/utils/client-portal/routing";
describe("client insights routing", () => {
  it("allows only reads of the scoped intelligence API", () => {
    expect(clientApiAllowed("/api/client/intelligence", "GET")).toBe(true);
    expect(clientApiAllowed("/api/client/intelligence", "HEAD")).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(clientApiAllowed("/api/client/intelligence", method)).toBe(false);
    expect(clientApiAllowed("/api/intelligence", "GET")).toBe(false);
    expect(clientApiAllowed("/api/intelligence/import", "POST")).toBe(false);
  });
});
