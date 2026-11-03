import { expect, it } from "vitest";
import { accessCommand } from "./contracts";
import { productSelection, visibleProducts } from "./products";
const invite = { operation: "invite", requestId: "ed610001-0000-4000-8000-000000000001", name: "Client", email: "client@example.com", propertyIds: ["ed610001-0000-4000-8000-000000000002"] };
it("preserves legacy access without exposing new products", () => {
  expect(visibleProducts({})).toEqual(["reporting", "lumaleasing"]);
  expect(accessCommand.parse(invite)).toMatchObject({ products: ["reporting", "lumaleasing"] });
});
it("allows all products hidden while retaining property grants", () => {
  expect(accessCommand.parse({ ...invite, products: [] })).toMatchObject({ products: [], propertyIds: invite.propertyIds });
  expect(visibleProducts({ products: [] })).toEqual([]);
});
it("accepts new products and rejects unknown and duplicate selections", () => {
  expect(productSelection.parse(["marketvision", "reviewflow"])).toHaveLength(2);
  expect(productSelection.safeParse(["internal_admin"]).success).toBe(false);
  expect(productSelection.safeParse(["reviewflow", "reviewflow"]).success).toBe(false);
});

it("edits products on the existing invitation without changing its recipient or properties", () => {
  const command = { operation: "update_invitation_products", requestId: invite.requestId, targetId: invite.requestId, revision: 1, products: ["reviewflow"] };
  expect(accessCommand.parse(command)).toEqual(command);
  expect(accessCommand.safeParse({ ...command, revision: 0 }).success).toBe(false);
  expect(accessCommand.safeParse({ ...command, email: "different@example.com" }).success).toBe(false);
});
