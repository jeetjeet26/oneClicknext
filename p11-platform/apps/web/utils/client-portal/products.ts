import { z } from "zod";
export const portalProducts = [
  { id: "reporting", name: "Client reporting", description: "Marketing performance, leasing results and published reports", href: "/client/performance" },
  { id: "lumaleasing", name: "LumaLeasing", description: "Website conversations and inquiries", href: "/client/conversations" },
  { id: "marketvision", name: "MarketVision 360", description: "Tracked competitors and market context", href: "/client/marketvision" },
  { id: "reviewflow", name: "ReviewFlow AI", description: "Reviews and reputation", href: "/client/reviewflow" },
] as const;
export const productId = z.enum(["reporting", "lumaleasing", "marketvision", "reviewflow"]);
export type PortalProduct = z.infer<typeof productId>;
export const legacyPortalProducts: PortalProduct[] = ["reporting", "lumaleasing"];
export const productSelection = z.array(productId).max(portalProducts.length).refine(ids => new Set(ids).size === ids.length);
export function visibleProducts(scope: { products?: PortalProduct[] }) {
  return scope.products ?? legacyPortalProducts;
}
