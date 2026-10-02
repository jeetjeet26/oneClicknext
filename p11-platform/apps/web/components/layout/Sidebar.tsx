"use client";

import Link from "next/link";
import { P11Logo } from "@/components/ui/P11Logo";
import { usePathname } from "next/navigation";
import { Menu, ArrowUpRight, type LucideIcon } from "lucide-react";
import { navigationGroups, settingsNavigation } from "./navigation";

function NavLink({
  href,
  label,
  icon: Icon,
  description,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}) {
  const path = usePathname(),
    active =
      path === href || (href !== "/dashboard" && path.startsWith(href + "/"));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={description}
      onClick={(e) =>
        e.currentTarget.closest("details")?.removeAttribute("open")
      }
      className={`console-nav-link ${active ? "is-active" : ""}`}
    >
      <Icon size={17} strokeWidth={1.65} aria-hidden="true" />
      <span>{label}</span>
      {active && <span className="console-nav-dot" />}
    </Link>
  );
}
function SidebarContent() {
  return (
    <div className="console-sidebar-content">
      <Link
        className="console-brand"
        href="/dashboard"
        aria-label="P11 Console home"
      >
        <P11Logo />
        <span>
          <strong>Console</strong>
          <span className="console-brand-caption">Agency workspace</span>
        </span>
      </Link>
      <div className="console-workspace-label">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        Internal workspace
      </div>
      <div className="console-sidebar-scroll">
        {navigationGroups.map((group) => (
          <section key={group.label} className="console-nav-group">
            <h2>{group.label}</h2>
            <nav aria-label={group.label}>
              {group.items.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </nav>
          </section>
        ))}
      </div>
      <div className="console-sidebar-footer">
        <NavLink {...settingsNavigation} />
        <p>
          Real estate marketing. Amplified.
          <ArrowUpRight size={12} aria-hidden="true" />
        </p>
      </div>
    </div>
  );
}
export function Sidebar() {
  return (
    <aside className="console-sidebar">
      <div className="hidden h-dvh lg:block">
        <SidebarContent />
      </div>
      <details
        className="console-mobile-navigation lg:hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.currentTarget.removeAttribute("open");
            e.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary>
          <Menu size={20} aria-hidden="true" />
          <span>Navigation</span>
          <P11Logo className="p11-logo-mobile" />
        </summary>
        <div className="console-mobile-panel">
          <SidebarContent />
        </div>
      </details>
    </aside>
  );
}
