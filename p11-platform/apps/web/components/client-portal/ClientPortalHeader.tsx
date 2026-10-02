"use client";
import Link from "next/link";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { P11Logo } from "@/components/ui/P11Logo";
import { portalNavigation } from "@/components/layout/navigation";
import { signOut } from "@/app/auth/actions";

export function ClientPortalHeader({
  view,
  name,
  hasConversations,
  href,
}: {
  view: string;
  name?: string;
  hasConversations: boolean;
  href: (path: string) => string;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <header className="portal-header">
        <Link
          className="console-brand p-0!"
          href={href("/client")}
          aria-label="P11 client home"
        >
          <P11Logo />
          <span>
            <strong>Client workspace</strong>
            <span className="console-brand-caption">Property insights</span>
          </span>
        </Link>
        <nav aria-label="Client navigation" className="portal-nav">
          {portalNavigation
            .filter(
              (item) =>
                item.href !== "/client/conversations" || hasConversations,
            )
            .map((item) => {
              const active =
                item.href ===
                (view === "overview" ? "/client" : "/client/" + view);
              return (
                <Link
                  key={item.href}
                  href={href(item.href)}
                  aria-current={active ? "page" : undefined}
                  className={active ? "is-active" : ""}
                >
                  <item.icon size={15} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
        </nav>
        <div className="portal-account">
          <span className="hidden sm:block">
            <strong>{name ?? "Client workspace"}</strong>
            <small>Your P11 workspace</small>
          </span>
          <button
            className="console-action border-0! p-2!"
            aria-label="Sign out"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              setError("");
              void signOut().catch(() => {
                setSigningOut(false);
                setError("Sign-out could not be confirmed. Please try again.");
              });
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="console-error mx-6 mt-4">
          {error}
        </div>
      )}
    </>
  );
}
