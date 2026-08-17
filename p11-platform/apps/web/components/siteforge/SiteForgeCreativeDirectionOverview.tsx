"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { GuidedCreativeDirectionOverview } from "@/utils/siteforge/guided/contracts";

export function SiteForgeCreativeDirectionOverview({
  overview,
  busy,
  onEdit,
  onSelectAlternative,
}: {
  overview: GuidedCreativeDirectionOverview;
  busy: boolean;
  onEdit: (instruction: string) => void;
  onSelectAlternative: (directionId: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const direction = overview.selected.direction;
  const submit = () => {
    const value = instruction.trim();
    if (!value || busy) return;
    onEdit(value);
  };

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge className="mb-2">Recommended direction</Badge>
              <CardTitle className="text-2xl">{overview.selected.name}</CardTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {direction.rationale}
              </p>
            </div>
            <p className="max-w-sm rounded-lg border bg-background p-3 text-xs leading-5 text-muted-foreground">
              <strong className="text-foreground">Why this direction:</strong>{" "}
              {overview.recommendationReason}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-5">
          <section aria-labelledby="approved-brand">
            <h3 id="approved-brand" className="text-sm font-semibold">
              Latest approved Brand Book
            </h3>
            {overview.brandPresentation ? (
              <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,2fr)]">
                <div className="flex min-h-44 items-center justify-center rounded-xl border bg-muted/20 p-5">
                  {overview.brandPresentation.logo ? (
                    // BrandForge stores approved user-managed logo URLs.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={overview.brandPresentation.logo.url}
                      alt={overview.brandPresentation.logo.alt}
                      className="max-h-28 max-w-full object-contain"
                    />
                  ) : (
                    <p className="font-semibold">
                      {overview.brandPresentation.name}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Full approved palette
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {overview.brandPresentation.palette.map(color => (
                      <div
                        key={`${color.role}-${color.hex}`}
                        className="overflow-hidden rounded-lg border"
                        title={color.usage}
                      >
                        <div
                          className="h-14"
                          style={{ backgroundColor: color.hex }}
                        />
                        <div className="p-2 text-[11px]">
                          <span className="block font-medium">{color.name}</span>
                          <span className="block capitalize text-muted-foreground">
                            {color.role}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {color.hex}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {overview.brandPresentation.usageGuidelines ? (
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {overview.brandPresentation.usageGuidelines}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                The latest Brand Book presentation is unavailable.
              </p>
            )}
          </section>

          <section aria-labelledby="direction-palette">
            <h3 id="direction-palette" className="text-sm font-semibold">
              Proposed website color roles
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              These roles map approved colors into this direction. The Brand
              Book above remains the source of truth.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Object.entries(direction.palette).map(([role, color]) => (
                <div key={role} className="overflow-hidden rounded-lg border">
                  <div
                    className="h-14"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                  <div className="p-2 text-[11px]">
                    <span className="block capitalize">{role}</span>
                    <span className="font-mono text-muted-foreground">{color}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <DirectionSection title="Typography">
              <p
                className="text-3xl leading-tight"
                style={{ fontFamily: direction.typography.headingFamily }}
              >
                A place designed around your day.
              </p>
              <p
                className="mt-2 text-sm"
                style={{ fontFamily: direction.typography.bodyFamily }}
              >
                {direction.typography.headingFamily} /{" "}
                {direction.typography.bodyFamily}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {direction.typography.scale} ·{" "}
                {direction.typography.weightStrategy}
              </p>
            </DirectionSection>
            <DirectionSection title="Hero and layout">
              <Detail label="Composition" value={direction.hero.composition} />
              <Detail label="Headline" value={direction.hero.headlineStyle} />
              <Detail label="Media" value={direction.hero.mediaTreatment} />
              <Detail label="System" value={direction.layout.system} />
              <Detail
                label="Rhythm"
                value={`${direction.layout.density} · ${direction.layout.sectionRhythm}`}
              />
            </DirectionSection>
            <DirectionSection title="Photography">
              <Detail label="Style" value={direction.imagery.style} />
              <Detail label="Treatment" value={direction.imagery.treatment} />
              <ul className="mt-2 space-y-1 text-sm">
                {direction.imagery.subjects.map(subject => (
                  <li key={subject} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    {subject}
                  </li>
                ))}
              </ul>
            </DirectionSection>
            <DirectionSection title="Voice">
              <p className="text-sm font-medium">
                {direction.voice.traits.join(" · ")}
              </p>
              <VoiceList label="Do" values={direction.voice.do} />
              <VoiceList label="Don’t" values={direction.voice.dont} />
            </DirectionSection>
            <DirectionSection title="Primary action">
              <p className="text-xl font-semibold">{direction.cta.label}</p>
              <Detail label="Placement" value={direction.cta.placement} />
              <Detail label="Style" value={direction.cta.style} />
            </DirectionSection>
            <DirectionSection title="Tradeoffs">
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {direction.tradeoffs.map(tradeoff => (
                  <li key={tradeoff}>{tradeoff}</li>
                ))}
              </ul>
            </DirectionSection>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Refine this direction</CardTitle>
          <p className="text-sm text-muted-foreground">
            Describe a change in plain language. SiteForge will ask a question,
            reject unsafe changes, or create a new immutable direction version.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={instruction}
            onChange={event => setInstruction(event.target.value)}
            placeholder="For example: Make the hero feel warmer and more editorial, while keeping the approved palette."
            disabled={busy}
            aria-label="Creative direction edit"
          />
          <div className="flex justify-end">
            <Button onClick={submit} disabled={busy || !instruction.trim()}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Request change
            </Button>
          </div>
        </CardContent>
      </Card>

      <details className="group rounded-xl border">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 font-semibold">
          Change direction
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-3 border-t p-4 lg:grid-cols-2">
          {overview.alternatives.map(alternative => (
            <Card key={alternative.id}>
              <CardHeader>
                <CardTitle className="text-base">{alternative.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex gap-1">
                  {alternative.previewManifest.paletteSwatches.map((color, index) => (
                    <span
                      key={`${color}-${index}`}
                      className="h-8 flex-1 rounded border"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
                <p className="text-muted-foreground">
                  {alternative.direction.rationale}
                </p>
                <p className="text-xs">
                  {alternative.direction.typography.headingFamily} /{" "}
                  {alternative.direction.typography.bodyFamily}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() => onSelectAlternative(alternative.id)}
                >
                  Use this direction
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </details>
    </div>
  );
}

function DirectionSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-2 text-sm">
      <span className="font-medium">{label}:</span>{" "}
      <span className="text-muted-foreground">{value}</span>
    </p>
  );
}

function VoiceList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {values.map(value => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
