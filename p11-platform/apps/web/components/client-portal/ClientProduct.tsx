import { readClientProduct } from "@/utils/client-portal/product-data";
import { ClientProductView } from "./ClientProductView";
export async function ClientProduct({ actor, product }: { actor: string; product: "marketvision" | "reviewflow" }) {
  return <ClientProductView data={await readClientProduct(actor, product)} />;
}
