import { createServiceClient } from "@/utils/supabase/admin";
import { clientScope, PortalError } from "./server";
import { visibleProducts } from "./products";

export async function readClientProduct(actor: string, product: "marketvision" | "reviewflow") {
  const scope = await clientScope(actor);
  if (!visibleProducts(scope).includes(product)) throw new PortalError("This product is not available to your account.", 403);
  const ids = scope.properties.map(p => p.id);
  const db = createServiceClient();
  // Explicit projections exclude internal notes, raw provider data and response drafts.
  const result = !ids.length ? { data: [], error: null } : product === "marketvision"
    ? await db.from("competitors").select("id,property_id,name,address,last_scraped_at").in("property_id", ids).eq("is_active", true).order("name").limit(100)
    : await db.from("reviews").select("id,property_id,platform,rating,review_text,review_date").in("property_id", ids).order("review_date", { ascending: false, nullsFirst: false }).limit(100);
  if (result.error) throw new PortalError("This product could not be loaded. Please try again.");
  const current = await clientScope(actor);
  if (current.revision !== scope.revision || JSON.stringify(current.properties) !== JSON.stringify(scope.properties) || !visibleProducts(current).includes(product)) throw new PortalError("Your access changed. Refresh to continue.", 409);
  return {
    name: scope.name,
    products: visibleProducts(scope),
    properties: scope.properties.map(p => ({ id: p.id, name: p.name })),
    product,
    rows: (result.data ?? []).map(row => ({
      id: row.id,
      propertyId: row.property_id,
      property: scope.properties.find(p => p.id === row.property_id)?.name ?? "Property",
      title: "name" in row ? row.name : `${row.platform} · ${row.rating == null ? "Unrated" : `${row.rating}/5`}`,
      detail: "address" in row ? row.address : row.review_text,
      date: "last_scraped_at" in row ? row.last_scraped_at : row.review_date,
    })),
  };
}
