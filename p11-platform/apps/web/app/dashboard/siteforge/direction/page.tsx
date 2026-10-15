"use client";
import Link from "next/link";
import { usePropertyContext } from "@/components/layout/PropertyContext";
import { WebsiteDesignBrief } from "@/components/siteforge/WebsiteDesignBrief";

export default function WebsiteDirectionPage() {
  const { currentProperty } = usePropertyContext();
  if (!currentProperty?.id) return <p>Select a property to review its design brief.</p>;
  return <div className="space-y-6">
    <Link className="text-sm underline" href="/dashboard/siteforge">Back to SiteForge</Link>
    <WebsiteDesignBrief key={currentProperty.id} propertyId={currentProperty.id} propertyName={currentProperty.name} />
  </div>;
}
