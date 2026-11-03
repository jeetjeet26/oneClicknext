"use client";
import { useState } from "react";
import type { AccessAccount, AccessInvitation } from "@/utils/client-portal/contracts";
import { legacyPortalProducts, portalProducts, visibleProducts, type PortalProduct } from "@/utils/client-portal/products";

export function ClientProductAccess({ accounts, invitations, canManage, onInvite, onSaved }: {
  accounts: AccessAccount[];
  invitations: AccessInvitation[];
  canManage: boolean;
  onInvite: (products: PortalProduct[]) => void;
  onSaved: () => Promise<void>;
}) {
  const active = accounts.filter(account => account.status === "active");
  const pending = invitations.filter(invitation => invitation.status === "pending");
  const [selected, setSelected] = useState(active[0]?.id ?? pending[0]?.id ?? "new");
  const current = selected === "new" || active.some(a => a.id === selected) || pending.some(i => i.id === selected)
    ? selected : active[0]?.id ?? pending[0]?.id ?? "new";
  const account = active.find(account => account.id === current);
  const invitation = pending.find(invitation => invitation.id === current);
  return <section className="console-panel p-6" aria-labelledby="portal-products-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="portal-products-title" className="text-lg font-semibold">Client portal products</h2>
        <p className="console-muted mt-1">Control which products each client can see. Internal product activation stays independent.</p></div>
      <label className="console-field-label">Client
        <select value={current} onChange={event => setSelected(event.target.value)}>
          {active.map(a => <option key={a.id} value={a.id}>{a.name} — {a.email}</option>)}
          {pending.map(i => <option key={i.id} value={i.id}>{i.name} — {i.email} (invited)</option>)}
          <option value="new">New client invitation</option>
        </select>
      </label>
    </div>
    <ProductChoices key={account ? `${account.id}:${account.revision}` : invitation ? `${invitation.id}:${invitation.revision}` : "new"} account={account} invitation={invitation} canManage={canManage} onInvite={onInvite} onSaved={onSaved} />
  </section>;
}

function ProductChoices({ account, invitation, canManage, onInvite, onSaved }: {
  account?: AccessAccount;
  invitation?: AccessInvitation;
  canManage: boolean;
  onInvite: (products: PortalProduct[]) => void;
  onSaved: () => Promise<void>;
}) {
  const [products, setProducts] = useState<PortalProduct[]>(() => [...(account ? visibleProducts(account) : invitation ? visibleProducts(invitation) : legacyPortalProducts)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function toggle(product: PortalProduct, checked: boolean) {
    if (saving || !canManage) return;
    const next = checked ? [...products, product] : products.filter(id => id !== product);
    if (!account && !invitation) { setProducts(next); return; }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/client-portal/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(account
          ? { operation: "update", requestId: crypto.randomUUID(), targetId: account.id, revision: account.revision, propertyIds: account.properties, products: next }
          : { operation: "update_invitation_products", requestId: crypto.randomUUID(), targetId: invitation!.id, revision: invitation!.revision, products: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The product selection could not be saved.");
      setProducts(next);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally { setSaving(false); }
  }
  return <div className="mt-5">
    <fieldset disabled={!canManage || saving}>
      <legend className="sr-only">Products shown in the client portal</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {portalProducts.map(product => <label key={product.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4">
          <input className="mt-1" type="checkbox" checked={products.includes(product.id)} onChange={event => { void toggle(product.id, event.target.checked); }} />
          <span><strong className="block">{product.name}</strong><span className="console-muted">{product.description}</span><span className="mt-1 block text-xs text-slate-500">{products.includes(product.id) ? "Shown in client portal" : "Hidden from client portal"}</span></span>
        </label>)}
      </div>
    </fieldset>
    {error && <p className="console-error mt-3" role="alert">{error} <button className="underline" onClick={() => { void onSaved(); }}>Reload current settings</button></p>}
    <p className="console-muted mt-3" role="status">{saving ? "Saving product visibility…" : (account || invitation) ? "Changes save automatically to the same invitation and portal access. No new link or invitation is needed. Clients see updates when they open or refresh their portal." : "Choose products for a new invitation. You can change them here at any time, before or after the client joins, using the same link."}</p>
    {!account && !invitation && canManage && <button className="console-action console-action-primary mt-4" onClick={() => onInvite(products)}>Invite client with these products</button>}
  </div>;
}
