"use client";
import { FunnelSummary } from "@/components/client-portal/FunnelSummary";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePropertyContext } from "@/components/layout/PropertyContext";
import {
  deliveryCommand,
  type DeliveryInput,
  type Workspace,
} from "@/utils/delivery/contracts";
import { OutcomesPanel, ReportsPanel } from "./DeliveryPanels";
import { button } from "./styles";
const tabs = {
  reports: "Client reports",
  outcomes: "Leasing outcomes",
} as const;
export function DeliveryWorkspace() {
  const { currentProperty, hasLoadedProperties } = usePropertyContext();
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-7">
        <p className="text-xs font-medium uppercase tracking-widest text-[#a53212]">
          Client reporting
        </p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-950">
          Client reporting & outcomes.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Review results and publish client reports for {currentProperty.name}.
          Manage projects, assignments and deadlines in Basecamp.
        </p>
      </div>
      {hasLoadedProperties && currentProperty.id ? (
        <WorkspaceBody
          key={currentProperty.id}
          propertyId={currentProperty.id}
        />
      ) : (
        <p>Select a property to get started.</p>
      )}
    </div>
  );
}
async function request(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...init });
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error("The reply was interrupted. Check the saved request.");
  }
  if (!r.ok)
    throw Object.assign(
      Error(d.error || "The request could not be confirmed."),
      { status: r.status },
    );
  return d;
}
function WorkspaceBody({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<Workspace | null>(null),
    [tab, setTab] = useState<keyof typeof tabs>("reports"),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const alive = useRef(false),
    generation = useRef(0),
    lock = useRef(false);
  const refresh = useCallback(async () => {
    const g = ++generation.current;
    const d = await request(
      "/api/delivery?" +
        new URLSearchParams({ propertyId, offset: String(offset), search }),
    );
    if (d.propertyId !== propertyId || d.state !== "ready")
      throw Error("The response does not match this property.");
    if (alive.current && g === generation.current) {
      setData(d);
      const saved = sessionStorage.getItem(
        `p11.delivery.v1:${d.actorId}:${propertyId}`,
      );
      setPending(saved && /^[a-f0-9-]{36}$/.test(saved) ? saved : null);
    }
  }, [propertyId, offset, search]);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "The request could not be confirmed.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const key = data ? `p11.delivery.v1:${data.actorId}:${propertyId}` : "";
  async function save(input: DeliveryInput) {
    if (!data || pending || lock.current) return false;
    let success = false;
    await run(async () => {
      const c = deliveryCommand.parse({
        requestId: crypto.randomUUID(),
        expectedActorId: data.actorId,
        propertyId,
        input,
      });
      sessionStorage.setItem(key, c.requestId);
      setPending(c.requestId);
      try {
        const r = await request("/api/delivery", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(c),
        });
        if (r.id !== c.requestId || r.propertyId !== propertyId)
          throw Error("The saved result needs confirmation.");
        sessionStorage.removeItem(key);
        if (alive.current) {
          setPending(null);
          setNotice("Saved. The decision is recorded in activity history.");
        }
        success = true;
        await refresh();
      } catch (e) {
        if (
          (e as { status?: number }).status &&
          (e as { status: number }).status < 500
        ) {
          sessionStorage.removeItem(key);
          if (alive.current) setPending(null);
        }
        throw e;
      }
    });
    return success;
  }
  async function recover() {
    if (!pending || !data) return;
    await run(async () => {
      const r = await request(
        "/api/delivery?" +
          new URLSearchParams({ propertyId, receiptId: pending }),
      );
      if (r.id !== pending || r.actorId !== data.actorId)
        throw Error("Sign in with the account that made this request.");
      if (r.state === "not_recorded") {
        const closed = await request("/api/delivery", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: pending,
            expectedActorId: data.actorId,
            propertyId,
            input: { operation: "cancel_request" },
          }),
        });
        if (closed.id !== pending)
          throw Error("The request could not be closed.");
        setNotice(
          closed.status === "cancelled"
            ? "The unused request is closed. Review your changes before submitting again."
            : "Your earlier decision was saved.",
        );
      } else setNotice("Your earlier decision was saved.");
      sessionStorage.removeItem(key);
      setPending(null);
      await refresh();
    });
  }
  const disabled = busy || !!pending || !data?.canManage;
  const total = data
    ? tab === "reports"
      ? data.reportTotal
      : data.outcomeTotal
    : 0;
  return (
    <>
      <nav
        aria-label="Reporting sections"
        className="mb-6 flex gap-2 overflow-x-auto border-b border-slate-200"
      >
        {Object.entries(tabs).map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id as keyof typeof tabs);
              setOffset(0);
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${tab === id ? "border-[#a53212] font-medium text-[#a53212]" : "border-transparent text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {data?.canManage
            ? "Internal workspace · Clients see published reports only"
            : "Read-only staff access"}
        </p>
        <div className="flex gap-4">
          <Link
            href="/dashboard/agency"
            className="text-sm text-[#a53212] underline"
          >
            Review product issues
          </Link>
          <button
            className={button}
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {pending && (
        <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-medium">Confirm the earlier request</h2>
          <p className="my-2 text-sm">
            The reply was interrupted. Check whether it saved before making
            another change.
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() => void recover()}
          >
            Check saved result
          </button>
        </section>
      )}
      {!data ? (
        <p role="status">Loading reports and results…</p>
      ) : (
        <>
          {tab === "outcomes" && (
            <>
              <FunnelSummary
                current={data.funnel}
                previous={data.previousFunnel}
              />
              <OutcomesPanel
                data={data}
                disabled={disabled}
                save={save}
                search={search}
                setSearch={setSearch}
              />
            </>
          )}
          {tab === "reports" && (
            <ReportsPanel data={data} disabled={disabled} save={save} />
          )}
          {total > 50 && (
            <div className="mt-6 flex items-center justify-between gap-3 text-sm">
              <span>
                Showing {offset + 1}–{Math.min(offset + 50, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  className={button}
                  disabled={busy || offset === 0}
                  onClick={() => setOffset((n) => Math.max(0, n - 50))}
                >
                  Previous page
                </button>
                <button
                  className={button}
                  disabled={busy || offset + 50 >= total}
                  onClick={() => setOffset((n) => n + 50)}
                >
                  Next page
                </button>
              </div>
            </div>
          )}
          <Link
            href="/dashboard/activity"
            className="mt-8 inline-block text-sm text-[#a53212] underline"
          >
            View activity history
          </Link>
        </>
      )}
    </>
  );
}
