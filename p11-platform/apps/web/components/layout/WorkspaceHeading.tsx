"use client";
import { usePathname } from "next/navigation";
import { currentSection } from "./navigation";
export function WorkspaceHeading() {
  const section = currentSection(usePathname());
  return (
    <div className="console-location">
      <span>Workspace</span>
      <span aria-hidden="true">/</span>
      <strong>{section.label}</strong>
    </div>
  );
}
