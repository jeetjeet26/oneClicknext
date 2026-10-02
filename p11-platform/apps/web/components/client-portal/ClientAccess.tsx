"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Plus,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import type {
  AccessAccount,
  AccessRoster,
} from "@/utils/client-portal/contracts";
type Editor =
  | { kind: "invite"; name: string; email: string; properties: string[] }
  | { kind: "edit"; account: AccessAccount; properties: string[] }
  | { kind: "revoke"; account: AccessAccount }
  | { kind: "revoke_invitation"; id: string; name: string };
export function ClientAccess() {
  const [data, setData] = useState<AccessRoster | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [invitation, setInvitation] = useState(""),
    [copied, setCopied] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(
    () =>
      fetch("/api/client-portal/access", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok)
            throw Error(body.error || "Client access could not be loaded.");
          return body as AccessRoster;
        })
        .then((body) => {
          setData(body);
          setError("");
        })
        .catch((error) => {
          setError(
            error instanceof Error ? error.message : "Please try again.",
          );
          setData(null);
        })
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (editor || invitation) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editor, invitation]);
  function close() {
    if (busy) return;
    setEditor(null);
    setInvitation("");
    setCopied(false);
    setError("");
  }
  function open(value: Editor) {
    setError("");
    setNotice("");
    setEditor(value);
    request.current = null;
  }
  async function save() {
    if (!editor || busy) return;
    setBusy(true);
    setError("");
    try {
      const input =
        editor.kind === "invite"
          ? {
              operation: "invite",
              name: editor.name.trim(),
              email: editor.email.trim(),
              propertyIds: editor.properties,
            }
          : editor.kind === "edit"
            ? {
                operation: "update",
                targetId: editor.account.id,
                revision: editor.account.revision,
                propertyIds: editor.properties,
              }
            : editor.kind === "revoke"
              ? {
                  operation: "revoke",
                  targetId: editor.account.id,
                  revision: editor.account.revision,
                }
              : { operation: "revoke_invitation", targetId: editor.id };
      const key = JSON.stringify(input);
      if (request.current?.key !== key)
        request.current = { key, id: crypto.randomUUID() };
      const response = await fetch("/api/client-portal/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, requestId: request.current.id }),
        }),
        result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Your change could not be saved.");
      if (result.invitationToken) {
        setInvitation(
          `${window.location.origin}/join/client#token=${result.invitationToken}`,
        );
        setNotice(
          "Invitation created. Copy the private link to share with your client.",
        );
      } else
        setNotice(
          editor.kind === "invite"
            ? "This invitation was already created. If you did not save its link, withdraw it and create a new one."
            : "Client access updated.",
        );
      setEditor(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const active =
      data?.accounts.filter((a) => a.status === "active").length ?? 0,
    pending = data?.invitations.filter((i) => i.status === "pending") ?? [];
  return (
    <div className="space-y-7">
      <div className="console-page-heading">
        <div>
          <p className="console-kicker">Workspace</p>
          <h1>Client access</h1>
          <p>Give clients a clear view of their properties and results.</p>
        </div>
        <div className="flex gap-2">
          <button
            className="console-action"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
            disabled={loading}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          {data?.canManage && (
            <button
              className="console-action console-action-primary"
              onClick={() =>
                open({ kind: "invite", name: "", email: "", properties: [] })
              }
            >
              <Plus size={16} />
              Invite client
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p className="console-notice" role="status">
          <Check size={17} />
          {notice}
        </p>
      )}
      {error && !editor && (
        <p className="console-error" role="alert">
          {error}
        </p>
      )}
      <div className="console-panel p-6 flex flex-col sm:flex-row gap-6 sm:items-center justify-between">
        <div className="flex gap-4">
          <div className="console-icon-tile">
            <Users size={21} />
          </div>
          <div>
            <h2 className="font-semibold">A dedicated reporting experience</h2>
            <p className="console-muted mt-1 max-w-2xl">
              Clients can see analytics, saved report summaries and property
              information. They only see the properties you assign. Your team
              manages all changes here.
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <span className="text-3xl font-medium">{loading ? "—" : active}</span>
          <span className="console-muted ml-2">
            active {active === 1 ? "client" : "clients"}
          </span>
        </div>
      </div>
      {!loading && data && !data.canManage && (
        <p className="console-muted">
          Only workspace administrators can invite clients or change access.
        </p>
      )}
      <section className="console-panel overflow-hidden">
        <div className="console-panel-heading">
          <div>
            <h2>Client accounts</h2>
            <p>Review who can view each property.</p>
          </div>
        </div>
        {loading ? (
          <p className="console-empty" role="status">
            Loading client accounts…
          </p>
        ) : data?.accounts.length ? (
          <div className="overflow-x-auto">
            <table className="console-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Properties</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <span className="block console-muted">{a.email}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {a.properties.map((id) => (
                          <span className="console-tag" key={id}>
                            {data.properties.find((p) => p.id === id)?.name ||
                              "Property no longer available"}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span
                        className={
                          a.status === "active"
                            ? "console-status-active"
                            : "console-tag"
                        }
                      >
                        {a.status === "active" ? "Active" : "Access removed"}
                      </span>
                    </td>
                    <td>
                      {data.canManage && (
                        <div className="flex gap-2 justify-end">
                          <button
                            className="console-action"
                            onClick={() =>
                              open({
                                kind: "edit",
                                account: a,
                                properties: a.properties.filter((id) =>
                                  data.properties.some((p) => p.id === id),
                                ),
                              })
                            }
                          >
                            {a.status === "active"
                              ? "Edit properties"
                              : "Restore access"}
                          </button>
                          {a.status === "active" && (
                            <button
                              className="console-link text-red-700"
                              onClick={() =>
                                open({ kind: "revoke", account: a })
                              }
                            >
                              Remove access
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="console-empty">
            <Users size={27} className="mx-auto mb-3" />
            <h3>No client accounts yet</h3>
            <p>Invite a client and choose the properties they can view.</p>
          </div>
        )}
      </section>
      <section className="console-panel overflow-hidden">
        <div className="console-panel-heading">
          <div>
            <h2>Pending invitations</h2>
            <p>Private invitation links expire after seven days.</p>
          </div>
        </div>
        {pending.length ? (
          <div className="overflow-x-auto">
            <table className="console-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Properties</th>
                  <th>Expires</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.name}</strong>
                      <span className="block console-muted">{i.email}</span>
                    </td>
                    <td>
                      {i.properties
                        .map(
                          (id) =>
                            data?.properties.find((p) => p.id === id)?.name ||
                            "Unavailable property",
                        )
                        .join(", ")}
                    </td>
                    <td>{new Date(i.expiresAt).toLocaleDateString()}</td>
                    <td>
                      {data?.canManage && (
                        <button
                          className="console-link"
                          onClick={() =>
                            open({
                              kind: "revoke_invitation",
                              id: i.id,
                              name: i.name,
                            })
                          }
                        >
                          Withdraw invitation
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="console-empty">
            {loading
              ? "Loading invitations…"
              : "No invitations awaiting acceptance."}
          </p>
        )}
      </section>
      <dialog
        ref={dialog}
        className="console-dialog"
        aria-labelledby="access-dialog-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="console-kicker">Client access</p>
              <h2 id="access-dialog-title" className="text-2xl font-semibold">
                {invitation
                  ? "Your invitation is ready"
                  : editor?.kind === "invite"
                    ? "Invite a client"
                    : editor?.kind === "edit"
                      ? "Choose property access"
                      : editor?.kind === "revoke"
                        ? "Remove client access?"
                        : "Withdraw this invitation?"}
              </h2>
            </div>
            <button
              className="console-icon-button"
              aria-label="Close"
              disabled={busy}
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          {invitation ? (
            <div className="space-y-5 mt-5">
              <p className="console-muted">
                Share this private link directly with your client. They will
                sign in or create an account using the email address you
                provided.
              </p>
              <label className="console-field-label">
                Private invitation link
                <input
                  readOnly
                  value={invitation}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <button
                className="console-action console-action-primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invitation);
                    setCopied(true);
                  } catch {
                    setError("Select the link above and copy it manually.");
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? "Copied" : "Copy invitation link"}
              </button>
              <p className="console-muted">
                The link is shown once. If you lose it, withdraw this invitation
                and create a new one.
              </p>
            </div>
          ) : (
            editor && (
              <form
                className="mt-6 space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                {editor.kind === "invite" && (
                  <>
                    <label className="console-field-label">
                      Client name
                      <input
                        autoFocus
                        required
                        maxLength={120}
                        autoComplete="name"
                        value={editor.name}
                        disabled={busy}
                        onChange={(e) =>
                          setEditor({ ...editor, name: e.target.value })
                        }
                      />
                    </label>
                    <label className="console-field-label">
                      Email address
                      <input
                        required
                        type="email"
                        maxLength={254}
                        autoComplete="email"
                        value={editor.email}
                        disabled={busy}
                        onChange={(e) =>
                          setEditor({ ...editor, email: e.target.value })
                        }
                      />
                    </label>
                    <p className="console-muted">
                      Use a separate account for client reporting. Existing
                      internal team accounts keep their workspace access.
                    </p>
                  </>
                )}
                {(editor.kind === "invite" || editor.kind === "edit") && (
                  <fieldset disabled={busy}>
                    <legend className="font-medium text-sm mb-2">
                      Properties this client can view
                    </legend>
                    <div className="console-property-checks">
                      {data?.properties.map((p) => (
                        <label key={p.id}>
                          <input
                            type="checkbox"
                            checked={editor.properties.includes(p.id)}
                            onChange={(e) =>
                              setEditor({
                                ...editor,
                                properties: e.target.checked
                                  ? [...editor.properties, p.id]
                                  : editor.properties.filter(
                                      (id) => id !== p.id,
                                    ),
                              })
                            }
                          />
                          <span>{p.name}</span>
                        </label>
                      ))}
                    </div>
                    {!data?.properties.length && (
                      <p className="console-muted">
                        Add a property to your workspace before inviting a
                        client.
                      </p>
                    )}
                    <p className="console-muted mt-2">
                      Choose at least one property. Clients cannot edit or
                      manage these properties.
                    </p>
                  </fieldset>
                )}
                {editor.kind === "revoke" && (
                  <p className="console-muted">
                    {editor.account.name} will lose access to all property
                    reporting, including in an existing session. You can restore
                    access later.
                  </p>
                )}
                {editor.kind === "revoke_invitation" && (
                  <p className="console-muted">
                    The invitation link for {editor.name} will stop working. You
                    can create another invitation later.
                  </p>
                )}
                {error && (
                  <p role="alert" className="console-error">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    disabled={busy}
                    className="console-action"
                    onClick={close}
                  >
                    Cancel
                  </button>
                  <button
                    className="console-action console-action-primary"
                    disabled={
                      busy ||
                      ((editor.kind === "invite" || editor.kind === "edit") &&
                        !editor.properties.length)
                    }
                  >
                    {busy
                      ? "Saving…"
                      : editor.kind === "invite"
                        ? "Create invitation"
                        : editor.kind === "edit"
                          ? "Save access"
                          : editor.kind === "revoke"
                            ? "Remove access"
                            : "Withdraw invitation"}
                    {editor.kind === "invite" && <ArrowUpRight size={16} />}
                  </button>
                </div>
              </form>
            )
          )}
          {invitation && error && (
            <p role="alert" className="console-error mt-4">
              {error}
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
}
