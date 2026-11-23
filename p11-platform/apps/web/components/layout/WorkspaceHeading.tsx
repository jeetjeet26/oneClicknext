"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { currentSection } from "./navigation";
export function WorkspaceHeading() {
  const section = currentSection(usePathname(), useSearchParams().get("section"));
  return (
    <div className="console-location">
      <span>Workspace</span>
      <span aria-hidden="true">/</span>
      <strong>{section.label}</strong>
    </div>
  );
}
