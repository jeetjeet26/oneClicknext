import { NextResponse } from "next/server";
import { observationTemplate } from "@/utils/intelligence/import";
export function GET() {
  return new NextResponse(observationTemplate, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="p11-observations.csv"',
    },
  });
}
