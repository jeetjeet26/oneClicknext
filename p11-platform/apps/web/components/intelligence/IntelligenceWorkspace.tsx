"use client";
import { usePropertyContext } from "@/components/layout/PropertyContext";
import { ReviewedRecordsWorkspace, type PerformanceSection } from "./ReviewedRecordsWorkspace";

export function IntelligenceWorkspace({ section = "insights" }: { section?: PerformanceSection }) {
  const { currentProperty } = usePropertyContext();
  if (!currentProperty?.id) return <p>Select a property to continue.</p>;
  return <ReviewedRecordsWorkspace key={`${currentProperty.id}:${section}`} propertyId={currentProperty.id} propertyName={currentProperty.name} mode="performance" initialSection={section} />;
}
