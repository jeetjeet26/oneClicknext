"use client";
import { P11Logo } from "@/components/ui/P11Logo";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Check, ArrowRight } from "lucide-react";
import { signOut } from "@/app/auth/actions";
async function request(path: string, init?: RequestInit) {
  const r = await fetch(path, { cache: "no-store", ...init }),
    data = await r.json();
  if (!r.ok)
    throw new Error(data.error ?? "Your invitation could not be loaded.");
  return data;
}
export function ClientJoin({ actorId }: { actorId: string | null }) {
  const router = useRouter();
  const [ready, setReady] = useState(false),
    [context, setContext] = useState<{
      name: string;
      organization: string;
      properties: string[];
      state: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    initial = useRef<Promise<void> | null>(null),
    requestId = useRef(crypto.randomUUID());
  const load = useCallback(() => {
    if (!initial.current)
      initial.current = (async () => {
        const token = new URLSearchParams(window.location.hash.slice(1)).get(
          "token",
        );
        if (token) {
          await request("/api/client-portal/join/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          window.history.replaceState(window.history.state, "", "/join/client");
        }
      })();
    return initial.current
      .then(async () => {
        setError("");
        setReady(true);
        if (actorId) setContext(await request("/api/client-portal/join"));
      })
      .catch((error) => {
        setError(
          error instanceof Error
            ? error.message
            : "This invitation is unavailable.",
        );
        initial.current = null;
      })
      .finally(() => setBusy(false));
  }, [actorId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      await request("/api/client-portal/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current, confirmed: true }),
      });
      router.replace("/client");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn’t confirm your access. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="console-shell min-h-dvh px-5 py-16">
      <section className="mx-auto max-w-lg console-panel p-8">
        <P11Logo className="mb-8" />
        <p className="console-kicker">Your client workspace</p>
        <h1 className="text-3xl font-medium tracking-tight">
          Welcome to a clearer view.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          Your property information and marketing results, all in one place.
          Your P11 team takes care of the management.
        </p>
        {error && (
          <div role="alert" className="console-error mt-6">
            {error}
            <button
              className="mt-2 block underline"
              onClick={() => {
                setBusy(true);
                void load();
              }}
            >
              Try again
            </button>
          </div>
        )}
        {busy && (
          <p role="status" className="mt-5 text-sm text-slate-500">
            Checking your invitation…
          </p>
        )}
        {ready && !actorId && (
          <div className="mt-7 space-y-4">
            <p className="text-sm text-slate-600">
              Sign in with the email address your invitation was sent to. If
              you’re new here, create your password and verify your email first.
            </p>
            <Link
              className="console-action console-action-primary w-full"
              href="/auth/login?redirect=%2Fjoin%2Fclient"
            >
              Sign in to continue
              <ArrowRight size={15} />
            </Link>
            <Link
              className="console-action w-full"
              href="/auth/signup?redirect=%2Fjoin%2Fclient"
            >
              Create your account
            </Link>
            <p className="text-xs text-slate-400">
              If you verify your email in another browser, reopen your
              invitation link there.
            </p>
          </div>
        )}
        {context?.state === "ready" && (
          <div className="mt-7">
            <p className="text-sm font-medium">Hello, {context.name}</p>
            <p className="mt-1 text-xs text-slate-500">
              Your team has shared these properties:
            </p>
            <ul className="my-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {context.properties.map((name, i) => (
                <li key={i} className="flex items-center gap-3 p-4 text-sm">
                  <Building2 size={17} className="text-slate-400" />
                  {name}
                  <Check size={14} className="ml-auto text-emerald-600" />
                </li>
              ))}
            </ul>
            <button
              className="console-action console-action-primary w-full"
              disabled={busy}
              onClick={() => void accept()}
            >
              Open my workspace
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {context?.state === "joined" && (
          <Link
            className="console-action console-action-primary mt-7 w-full"
            href="/client"
          >
            Open my workspace
            <ArrowRight size={15} />
          </Link>
        )}
        {actorId && (
          <button
            className="mt-6 text-xs text-slate-500 underline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signOut().catch(() => {
                setError("Sign-out could not be confirmed. Try again.");
                setBusy(false);
              });
            }}
          >
            Sign out to use another account
          </button>
        )}
      </section>
    </main>
  );
}
