"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronDown,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { ClientPortalHeader } from "./ClientPortalHeader";
import type { ClientConversationsData } from "@/utils/client-portal/conversation-contracts";

const timestamp = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Date unavailable";
type ResponseState = {
  key: string;
  data: ClientConversationsData | null;
  error: string;
};
function useConversations(query: string | null, revision: number) {
  const key = JSON.stringify([query, revision]);
  const [response, setResponse] = useState<ResponseState | null>(null);
  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    void fetch("/api/client-portal/conversations?" + query, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new Error(body.error ?? "Conversations could not be loaded.");
        if (!controller.signal.aborted)
          setResponse({ key, data: body, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setResponse({
            key,
            data: null,
            error:
              e instanceof Error
                ? e.message
                : "Conversations could not be loaded.",
          });
      });
    return () => controller.abort();
  }, [query, key]);
  return {
    loading: query !== null && response?.key !== key,
    data: response?.key === key ? response.data : null,
    error: response?.key === key ? response.error : "",
  };
}

export function ClientConversations() {
  const params = useSearchParams(),
    router = useRouter();
  const property = params.get("propertyId") ?? "",
    days = params.get("days") ?? "all";
  const offset = params.get("offset") ?? "0",
    conversationId = params.get("conversationId") ?? "",
    beforeId = params.get("beforeId") ?? "";
  const [revision, setRevision] = useState(0),
    [navigating, startNavigation] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const listQuery = new URLSearchParams({ days, offset });
  if (property) listQuery.set("propertyId", property);
  const detailQuery = new URLSearchParams();
  if (property) detailQuery.set("propertyId", property);
  if (conversationId) detailQuery.set("conversationId", conversationId);
  if (beforeId) detailQuery.set("beforeId", beforeId);
  const list = useConversations(listQuery.toString(), revision);
  const detail = useConversations(
    conversationId ? detailQuery.toString() : null,
    revision,
  );
  const data = list.data;
  const target = (
    changes: Record<string, string>,
    path = "/client/conversations",
  ) => {
    const q = new URLSearchParams(params);
    q.delete("reportOffset");
    for (const [key, value] of Object.entries(changes)) {
      if (value) q.set(key, value);
      else q.delete(key);
    }
    return path + (q.size ? "?" + q : "");
  };
  const navigate = (changes: Record<string, string>) =>
    startNavigation(() => router.push(target(changes), { scroll: false }));
  const navHref = (path: string) => {
    const q = new URLSearchParams();
    if (property) q.set("propertyId", property);
    if (["7", "30", "90"].includes(days)) q.set("days", days);
    return path + (q.size ? "?" + q : "");
  };
  useEffect(() => {
    const refresh = () => setRevision((r) => r + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (detail.data?.selected) heading.current?.focus({ preventScroll: true });
  }, [detail.data]);
  const selected = detail.data?.selected;
  const currentProperty = data?.properties.find((p) => p.id === property);
  return (
    <div className="console-shell portal-shell min-h-dvh">
      <a
        href="#client-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <ClientPortalHeader
        view="conversations"
        name={data?.name}
        hasConversations={!!data?.properties.length}
        href={navHref}
      />
      <main id="client-content" className="portal-main">
        <div className="portal-page-heading">
          <div>
            <p className="console-kicker">
              {currentProperty?.name ?? "LumaLeasing"}
            </p>
            <h1>Your leasing conversations.</h1>
            <p>
              See what visitors are asking and how your leasing assistant
              responds.
            </p>
          </div>
          <div className="portal-filters">
            <label>
              <Building2 size={15} aria-hidden="true" />
              <select
                aria-label="Property"
                value={property}
                disabled={list.loading || navigating}
                onChange={(e) =>
                  navigate({
                    propertyId: e.target.value,
                    offset: "",
                    conversationId: "",
                    beforeId: "",
                  })
                }
              >
                <option value="">All chatbot properties</option>
                {property && data && !currentProperty && (
                  <option value={property}>
                    Selected property has no chatbot
                  </option>
                )}
                {data?.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
            <label>
              <CalendarDays size={15} aria-hidden="true" />
              <select
                aria-label="Conversations started"
                value={days}
                disabled={navigating}
                onChange={(e) =>
                  navigate({
                    days: e.target.value,
                    offset: "",
                    conversationId: "",
                    beforeId: "",
                  })
                }
              >
                <option value="all">All time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </label>
            <button
              aria-label="Refresh conversations"
              className="console-action"
              disabled={list.loading || detail.loading}
              onClick={() => setRevision((r) => r + 1)}
            >
              <RefreshCw
                size={15}
                className={list.loading ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>
        <p className="mb-6 text-sm text-slate-600">
          Read-only chat history. Your P11 team manages replies and chatbot
          settings.
        </p>
        {currentProperty && !currentProperty.active && (
          <p className="mb-6 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            This chatbot is currently paused. Its saved conversations are still
            available here.
          </p>
        )}
        {list.error && (
          <ErrorNotice
            message={list.error}
            retry={() => setRevision((r) => r + 1)}
          />
        )}
        {list.loading && (
          <section className="console-panel p-8" role="status">
            Loading conversations…
          </section>
        )}
        {data && !data.properties.length && (
          <section className="console-panel console-empty">
            <MessageSquare size={32} />
            <h2>No chatbot conversations yet</h2>
            <p>
              LumaLeasing is not configured for your assigned properties. Your
              P11 team can help.
            </p>
          </section>
        )}
        {data && !!data.properties.length && (
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
            <section
              className={`console-panel min-w-0 self-start ${conversationId ? "hidden lg:block" : ""}`}
              aria-label="Conversation list"
            >
              <div className="console-panel-heading">
                <div>
                  <h2>Website conversations</h2>
                  <p>
                    Newest conversations first · times shown in your local time
                  </p>
                </div>
              </div>
              {!data.conversations.length ? (
                <div className="console-empty">
                  <MessageSquare size={28} />
                  <strong>No conversations in this view</strong>
                  <p>
                    Try another property or choose All time. Saved chats will
                    appear here when visitors use your chatbot.
                  </p>
                </div>
              ) : (
                <ul className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto" aria-label="Saved conversations" tabIndex={0}>
                  {data.conversations.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={target({ conversationId: c.id, beforeId: "" })}
                        scroll={false}
                        aria-current={
                          conversationId === c.id ? "true" : undefined
                        }
                        className={`block p-5 transition-colors hover:bg-orange-50/50 focus-visible:outline-2 focus-visible:outline-orange-700 ${conversationId === c.id ? "bg-orange-50/70" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">
                            {c.visitor}
                          </h3>
                          <ArrowRight
                            size={15}
                            className="shrink-0 text-slate-500"
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          {c.propertyName}
                        </p>
                        <p className="mt-3 line-clamp-2 break-words text-sm leading-6 text-slate-600">
                          {c.preview ?? "No visitor messages saved yet."}
                        </p>
                        <p className="mt-3 text-xs text-slate-500">
                          Started {timestamp(c.createdAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {(Number(offset) > 0 || data.nextOffset !== null) && (
                <div className="flex justify-between gap-3 border-t border-slate-100 p-4">
                  <button
                    className="console-action"
                    disabled={Number(offset) <= 0 || navigating}
                    onClick={() =>
                      navigate({
                        offset: String(Math.max(0, Number(offset) - 25)),
                        conversationId: "",
                        beforeId: "",
                      })
                    }
                  >
                    Previous
                  </button>
                  <button
                    className="console-action"
                    disabled={data.nextOffset === null || navigating}
                    onClick={() =>
                      navigate({
                        offset: String(data.nextOffset),
                        conversationId: "",
                        beforeId: "",
                      })
                    }
                  >
                    Next conversations
                  </button>
                </div>
              )}
            </section>
            <section
              className={`console-panel min-w-0 self-start ${!conversationId ? "hidden lg:block" : ""}`}
              aria-label="Conversation transcript"
            >
              {!conversationId ? (
                <div className="console-empty min-h-80">
                  <MessageSquare size={34} strokeWidth={1.3} />
                  <h2>Select a conversation</h2>
                  <p>
                    Read the exchange between a visitor and your leasing
                    assistant or team.
                  </p>
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-100 p-5 sm:p-6">
                    <button
                      className="mb-4 flex items-center gap-2 text-sm text-orange-800 lg:hidden"
                      onClick={() =>
                        navigate({ conversationId: "", beforeId: "" })
                      }
                    >
                      <ArrowLeft size={15} />
                      All conversations
                    </button>
                    <h2
                      ref={heading}
                      tabIndex={-1}
                      className="text-lg font-semibold text-slate-900 outline-none"
                    >
                      {selected?.visitor ?? "Conversation"}
                    </h2>
                    {selected && (
                      <p className="mt-1 text-xs leading-6 text-slate-600">
                        {selected.propertyName} · Started{" "}
                        {timestamp(selected.createdAt)}
                      </p>
                    )}
                  </div>
                  {detail.error && (
                    <div className="p-5">
                      <ErrorNotice
                        message={detail.error}
                        retry={() => setRevision((r) => r + 1)}
                      />
                    </div>
                  )}
                  {detail.loading && (
                    <p role="status" className="p-6 text-sm text-slate-500">
                      Loading messages…
                    </p>
                  )}
                  {selected && (
                    <>
                      {(detail.data?.nextBeforeId || beforeId) && (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 text-xs text-slate-600">
                          <p>
                            {beforeId
                              ? "Showing an earlier part of this conversation."
                              : "Showing the most recent 200 messages."}
                          </p>
                          {detail.data?.nextBeforeId && (
                            <button
                              className="console-action"
                              disabled={navigating}
                              onClick={() =>
                                navigate({
                                  beforeId: detail.data!.nextBeforeId!,
                                })
                              }
                            >
                              Earlier messages
                            </button>
                          )}
                          {beforeId && (
                            <button
                              className="console-action"
                              disabled={navigating}
                              onClick={() => navigate({ beforeId: "" })}
                            >
                              Latest messages
                            </button>
                          )}
                        </div>
                      )}
                      {!detail.data?.messages.length ? (
                        <p className="p-6 text-sm text-slate-600">
                          No visitor messages have been saved in this
                          conversation yet.
                        </p>
                      ) : (
                        <ol
                          className="max-h-[65vh] space-y-6 overflow-y-auto p-5 sm:p-6"
                          aria-label="Messages in chronological order"
                          tabIndex={0}
                        >
                          {detail.data.messages.map((m) => (
                            <li
                              key={m.id}
                              className={
                                m.role === "user"
                                  ? "mr-5 sm:mr-12"
                                  : "ml-5 sm:ml-12"
                              }
                            >
                              <div
                                className={`rounded-xl border p-4 ${m.role === "user" ? "border-slate-200 bg-slate-50" : "border-orange-100 bg-orange-50/50"}`}
                              >
                                <p className="mb-2 text-xs font-semibold text-slate-700">
                                  {m.role === "user"
                                    ? selected.visitor
                                    : "Leasing assistant / team"}
                                </p>
                                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800 [overflow-wrap:anywhere]">
                                  {m.content}
                                </p>
                              </div>
                              <p className="mt-2 px-1 text-[11px] text-slate-500">
                                {timestamp(m.createdAt)}
                              </p>
                            </li>
                          ))}
                        </ol>
                      )}
                      <p className="border-t border-slate-100 p-4 text-xs leading-5 text-slate-500">
                        Visitor messages and replies are shown as saved.
                        Internal system messages are not included.
                      </p>
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        )}
        <footer className="portal-footer">
          <span>P11 · Real estate marketing. Amplified.</span>
          <span>
            Conversations are available only for your assigned chatbot
            properties.
          </span>
        </footer>
      </main>
    </div>
  );
}
function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="console-error mb-6">
      <p>{message}</p>
      <button onClick={retry} className="mt-3 underline">
        Try again
      </button>
    </div>
  );
}
