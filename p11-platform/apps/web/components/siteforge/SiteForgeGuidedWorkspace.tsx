"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  SiteForgeDirectorCommand,
  SiteForgeDirectorSnapshot,
} from "@/utils/siteforge/director/contracts";
import type {
  GuidedAttachment,
  GuidedCreativeDirectionOverview,
  GuidedJourneyState,
  GuidedQuestion,
} from "@/utils/siteforge/guided/contracts";
import type {
  GuidedJourneyProjection,
  ScoredDirection,
} from "@/utils/siteforge/guided/journey";
import { PropertyAssetsStep } from "./PropertyAssetsStep";
import { SiteForgeCreativeDirectionOverview } from "./SiteForgeCreativeDirectionOverview";
import {
  buildGuidedJourney,
  buildPreparedRecommendation,
  conversationAnswer,
  friendlySiteForgeError,
  inferGuidedStep,
  plainSiteForgeProgress,
  type SiteForgeGuidedConfirmResponse,
  type SiteForgeGuidedConversationResponse,
  type SiteForgeGuidedDirectionEditResponse,
  type SiteForgeGuidedPrepareResponse,
  type SiteForgeGuidedSnapshotResponse,
  type SiteForgeGuidedStepId,
} from "./siteforge-guided-contracts";

const EditorWorkspace = dynamic(
  () =>
    import("./SiteForgeEditorWorkspace").then(
      (module) => module.SiteForgeEditorWorkspace,
    ),
  { loading: () => <WorkspaceLoading label="Opening your website preview…" /> },
);

const LaunchWorkspace = dynamic(
  () =>
    import("./SiteForgeOperationsPanel").then(
      (module) => module.SiteForgeOperationsPanel,
    ),
  { loading: () => <WorkspaceLoading label="Opening launch controls…" /> },
);

function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

function isActiveJob(snapshot: SiteForgeDirectorSnapshot | null) {
  return Boolean(
    snapshot?.jobs.some((job) =>
      ["queued", "running", "retrying"].includes(job.lifecycleStatus),
    ),
  );
}

function progressPercent(snapshot: SiteForgeDirectorSnapshot | null) {
  if (snapshot?.artifact.current.artifactId) return 100;
  const value =
    snapshot?.jobs.find((job) => job.domain === "siteforge.generation")
      ?.progress || 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function SiteForgeGuidedWorkspace({
  websiteId,
  propertyId,
  initialSnapshot,
}: {
  websiteId: string;
  propertyId: string;
  initialSnapshot?: SiteForgeDirectorSnapshot | null;
}) {
  const [director, setDirector] = useState<SiteForgeDirectorSnapshot | null>(
    initialSnapshot || null,
  );
  const [state, setState] = useState<GuidedJourneyState | null>(null);
  const [question, setQuestion] = useState<GuidedQuestion | null>(null);
  const [creativeDirection, setCreativeDirection] =
    useState<GuidedCreativeDirectionOverview | null>(null);
  const [projection, setProjection] = useState<GuidedJourneyProjection | null>(
    null,
  );
  const [scoredDirections, setScoredDirections] = useState<ScoredDirection[]>(
    [],
  );
  const [activeStep, setActiveStep] = useState<SiteForgeGuidedStepId>(
    inferGuidedStep(initialSnapshot || null),
  );
  const [draft, setDraft] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [attachments, setAttachments] = useState<GuidedAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [photoCount, setPhotoCount] = useState(0);
  const [retryAction, setRetryAction] = useState<
    "snapshot" | "prepare" | "confirm" | null
  >(null);

  const journey = useMemo(
    () => buildGuidedJourney(director, projection),
    [director, projection],
  );
  const recommendation = useMemo(
    () => buildPreparedRecommendation(state, scoredDirections),
    [scoredDirections, state],
  );
  const currentStep = inferGuidedStep(director, projection);

  const applyPayload = useCallback(
    (payload: SiteForgeGuidedSnapshotResponse, navigate = true) => {
      setState(payload.state);
      setQuestion(payload.question);
      setCreativeDirection(payload.creativeDirection);
      setProjection(payload.journey);
      if (navigate) setActiveStep(inferGuidedStep(null, payload.journey));
    },
    [],
  );

  const loadDirector = useCallback(async () => {
    const response = await fetch(`/api/siteforge/director/${websiteId}`, {
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        friendlySiteForgeError(body, "We could not refresh build progress."),
      );
    }
    setDirector(body as SiteForgeDirectorSnapshot);
  }, [websiteId]);

  const loadGuided = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      const response = await fetch(
        `/api/siteforge/guided/${websiteId}/snapshot`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          friendlySiteForgeError(
            body,
            "We could not resume this guided build.",
          ),
        );
      }
      applyPayload(body as SiteForgeGuidedSnapshotResponse, !quiet);
      if (!quiet) setLoading(false);
    },
    [applyPayload, websiteId],
  );

  const refreshAll = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        await Promise.all([loadDirector(), loadGuided(quiet)]);
        setError("");
        setRetryAction(null);
      } catch (cause) {
        setError(
          friendlySiteForgeError(
            cause instanceof Error ? cause.message : cause,
            "We could not refresh SiteForge. Your saved work is unchanged.",
          ),
        );
        setRetryAction("snapshot");
      } finally {
        if (!quiet) {
          setRefreshing(false);
          setLoading(false);
        }
      }
    },
    [loadDirector, loadGuided],
  );

  useEffect(() => {
    void loadGuided().catch((cause) => {
      setLoading(false);
      setError(
        friendlySiteForgeError(
          cause instanceof Error ? cause.message : cause,
          "We could not open your guided workspace.",
        ),
      );
      setRetryAction("snapshot");
    });
  }, [loadGuided]);

  useEffect(() => {
    const shouldPoll =
      projection?.stage === "progress" || isActiveJob(director);
    if (!shouldPoll) return;
    const timer = window.setInterval(() => void refreshAll(true), 8_000);
    return () => window.clearInterval(timer);
  }, [director, projection?.stage, refreshAll]);

  useEffect(() => {
    const generation = director?.jobs.find(
      job => job.domain === "siteforge.generation",
    );
    if (
      generation &&
      ["failed", "cancelled", "succeeded"].includes(
        generation.lifecycleStatus,
      )
    ) {
      setNotice(current =>
        /build is underway|attempt started/i.test(current) ? "" : current,
      );
    }
  }, [director]);

  function addReference() {
    const value = referenceUrl.trim();
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      setAttachments((current) => [
        ...current,
        { kind: "reference", name: url.hostname, url: url.toString() },
      ]);
      setReferenceUrl("");
      setError("");
    } catch {
      setError("Enter a complete http:// or https:// reference address.");
    }
  }

  async function uploadDocuments(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const uploaded: GuidedAttachment[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("propertyId", propertyId);
        form.set("title", file.name.replace(/\.[^/.]+$/, ""));
        form.set("file", file);
        const response = await fetch("/api/documents/upload", {
          method: "POST",
          body: form,
        });
        const body = await response.json().catch(() => ({}));
        const sourceId = Array.isArray(body.documentIds)
          ? body.documentIds.find((id: unknown) => typeof id === "string")
          : null;
        if (!response.ok || typeof sourceId !== "string") {
          throw new Error(
            friendlySiteForgeError(body, `We could not attach ${file.name}.`),
          );
        }
        uploaded.push({
          kind: "document",
          name: file.name,
          sourceId,
          url:
            typeof body.originalFileUrl === "string"
              ? body.originalFileUrl
              : undefined,
          mediaType: file.type || undefined,
          sizeBytes: file.size,
        });
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Document upload failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendAnswer() {
    if (!state || !question || busy) return;
    const answer = conversationAnswer(question.field, draft, attachments);
    if (
      !draft.trim() &&
      !(question.field === "references" && attachments.length)
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/siteforge/guided/${websiteId}/conversation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            expectedRevision: state.revision,
            field: question.field,
            answer,
            attachments,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          friendlySiteForgeError(body, "SiteForge could not save that answer."),
        );
      }
      applyPayload(body as SiteForgeGuidedConversationResponse);
      setDraft("");
      setAttachments([]);
      if (!(body as SiteForgeGuidedConversationResponse).question) {
        setActiveStep("visuals");
      }
    } catch (cause) {
      setError(
        friendlySiteForgeError(
          cause instanceof Error ? cause.message : cause,
          "SiteForge could not save that answer. Your draft is still here.",
        ),
      );
      setRetryAction("snapshot");
    } finally {
      setBusy(false);
    }
  }

  async function prepareRecommendation() {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/siteforge/guided/${websiteId}/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey:
              state.preparation?.idempotencyKey ||
              `prepare-${websiteId}-${state.revision}`,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          friendlySiteForgeError(
            body,
            "SiteForge could not prepare the recommendation.",
          ),
        );
      }
      const payload = body as SiteForgeGuidedPrepareResponse;
      setScoredDirections(payload.scoredDirections || []);
      applyPayload(payload);
      setActiveStep("recommendation");
      setNotice("Your recommendation is ready to review.");
      setRetryAction(null);
    } catch (cause) {
      setError(
        friendlySiteForgeError(
          cause instanceof Error ? cause.message : cause,
          "SiteForge could not prepare the recommendation. Your work is saved.",
        ),
      );
      setRetryAction("prepare");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRecommendation() {
    if (!state?.prepared || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const prepared = state.prepared;
      const response = await fetch(
        `/api/siteforge/guided/${websiteId}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: `confirm-${websiteId}-${prepared.planRevision}`,
            expected: {
              briefContentHash: prepared.briefContentHash,
              directionSetContentHash: prepared.directionSetContentHash,
              planContentHash: prepared.planContentHash,
            },
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          friendlySiteForgeError(body, "SiteForge could not start the build."),
        );
      }
      applyPayload(body as SiteForgeGuidedConfirmResponse);
      setActiveStep("progress");
      setNotice("The private website build is underway.");
      setRetryAction(null);
      await loadDirector();
    } catch (cause) {
      setError(
        friendlySiteForgeError(
          cause instanceof Error ? cause.message : cause,
          "SiteForge could not start the build. Nothing was published.",
        ),
      );
      setRetryAction("confirm");
    } finally {
      setBusy(false);
    }
  }

  async function editCreativeDirection(
    instruction?: string,
    alternativeDirectionId?: string,
  ) {
    if (!state?.prepared || !creativeDirection || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/siteforge/guided/${websiteId}/direction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientRequestId: crypto.randomUUID(),
            ...(instruction ? { instruction } : {}),
            ...(alternativeDirectionId ? { alternativeDirectionId } : {}),
            expectedRevision: state.revision,
            expected: {
              directionSetContentHash:
                creativeDirection.directionSetContentHash,
              selectedDirectionContentHash:
                creativeDirection.selected.contentHash,
            },
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          friendlySiteForgeError(
            body,
            "SiteForge could not edit that direction. Nothing changed.",
          ),
        );
      }
      const payload = body as SiteForgeGuidedDirectionEditResponse;
      applyPayload(payload, false);
      setNotice(
        payload.editOutcome?.outcome === "clarification"
          ? payload.editOutcome.question ||
              "SiteForge needs one more detail before changing the direction."
          : payload.editOutcome?.outcome === "rejection"
            ? payload.editOutcome.reason ||
              "That change conflicts with the pinned property or brand truth."
            : payload.duplicate
              ? "That edit was already applied."
              : "A new immutable creative direction version is ready.",
      );
    } catch (cause) {
      setError(
        friendlySiteForgeError(
          cause instanceof Error ? cause.message : cause,
          "SiteForge could not edit that direction. Nothing changed.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryBuild(command: SiteForgeDirectorCommand) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(command.target.path, {
        method: command.target.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command.payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          friendlySiteForgeError(body, "The build could not restart."),
        );
      }
      setNotice(
        "A new attempt started with the same approved inputs. Nothing was published.",
      );
      await refreshAll();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The build could not restart.",
      );
    } finally {
      setBusy(false);
    }
  }

  const latestGenerationJob = director?.jobs.find(
    (job) => job.domain === "siteforge.generation",
  );
  const retryCommand = director?.commands.find(
    (command) =>
      command.type === "retry_job" &&
      command.available &&
      command.target.path.includes(latestGenerationJob?.id || "/missing/"),
  );
  const hasArtifact = Boolean(director?.artifact.current.artifactId);

  return (
    <main className="space-y-6" aria-labelledby="siteforge-guided-title">
      <header className="rounded-2xl border bg-gradient-to-br from-indigo-950 via-slate-950 to-slate-900 px-6 py-7 text-white">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm text-indigo-200">
              <Sparkles className="h-4 w-4" /> AI-guided website studio
            </p>
            <h1 id="siteforge-guided-title" className="text-3xl font-semibold">
              Build your property website
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Answer one question at a time, review the real visual sources,
              then approve one durable recommendation before SiteForge builds.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border-white/20 bg-white/10 text-white">
              {journey.find((item) => item.id === currentStep)?.label}
            </Badge>
            <Button
              size="sm"
              variant="inverted"
              onClick={() => void refreshAll()}
              disabled={refreshing}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Resume / refresh
            </Button>
          </div>
        </div>
      </header>

      <nav aria-label="SiteForge journey" className="overflow-x-auto">
        <ol className="grid min-w-[900px] grid-cols-7 gap-2">
          {journey.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setActiveStep(item.id)}
                disabled={item.state === "upcoming"}
                className={`h-full w-full rounded-xl border p-3 text-left ${
                  activeStep === item.id
                    ? "border-primary bg-accent text-accent-foreground"
                    : item.state === "complete"
                      ? "border-success/40 bg-success/10"
                      : item.state === "needs_attention"
                        ? "border-destructive/50 bg-destructive/10"
                        : "bg-background"
                } disabled:cursor-not-allowed disabled:opacity-60`}
                aria-current={item.id === activeStep ? "step" : undefined}
              >
                <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {item.state === "complete" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="block text-xs font-semibold">
                  {item.label}
                </span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {item.id === currentStep
                    ? "Current"
                    : item.state === "complete"
                      ? "Complete"
                      : item.state === "needs_attention"
                        ? "Needs attention"
                        : "Not started"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground"
        >
          <span>{error}</span>
          {retryAction ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (retryAction === "prepare") void prepareRecommendation();
                else if (retryAction === "confirm")
                  void confirmRecommendation();
                else void refreshAll();
              }}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-success/40 bg-success/10 p-4 text-sm text-foreground"
        >
          {notice}
        </div>
      ) : null}

      {loading && !state ? (
        <WorkspaceLoading label="Resuming your SiteForge conversation…" />
      ) : (
        <section className="min-h-[500px]">
          {activeStep === "conversation" ? (
            <ConversationStep
              state={state}
              question={question}
              draft={draft}
              attachments={attachments}
              referenceUrl={referenceUrl}
              busy={busy}
              onDraftChange={setDraft}
              onReferenceUrlChange={setReferenceUrl}
              onAddReference={addReference}
              onRemoveAttachment={(index) =>
                setAttachments((current) =>
                  current.filter((_, i) => i !== index),
                )
              }
              onDocuments={(files) => void uploadDocuments(files)}
              onSend={() => void sendAnswer()}
              onVisuals={() => setActiveStep("visuals")}
            />
          ) : null}

          {activeStep === "visuals" ? (
            <div className="space-y-5">
              <StepHeading
                eyebrow="Photos and floor plans"
                title="Review the visual truth separately"
                description="Upload and categorize real property visuals. Preview floor-plan extraction, correct any fields, and confirm only the results SiteForge should use."
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <InfoCard
                  title="AI input"
                  detail="SiteForge uses only saved, categorized assets and confirmed floor-plan rows."
                />
                <InfoCard
                  title="Analysis result"
                  detail={`${photoCount} property photo${photoCount === 1 ? "" : "s"} currently available.`}
                />
                <InfoCard
                  title="Your corrections"
                  detail="Remove mismatched photos, change categories, and fix floor-plan values before preparing."
                />
              </div>
              <PropertyAssetsStep
                propertyId={propertyId}
                onPhotoCountChange={setPhotoCount}
              />
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => setActiveStep("conversation")}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => void prepareRecommendation()}
                  disabled={busy || !state || Boolean(question)}
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Prepare recommendation
                </Button>
              </div>
            </div>
          ) : null}

          {activeStep === "recommendation" ? (
            recommendation ? (
              <div className="space-y-5">
                <StepHeading
                  eyebrow="Recommendation"
                  title={recommendation.headline}
                  description={recommendation.summary}
                />
                {creativeDirection ? (
                  <SiteForgeCreativeDirectionOverview
                    overview={creativeDirection}
                    busy={busy}
                    onEdit={instruction =>
                      void editCreativeDirection(instruction)
                    }
                    onSelectAlternative={directionId =>
                      void editCreativeDirection(undefined, directionId)
                    }
                  />
                ) : null}
                <div className="grid gap-4 lg:grid-cols-2">
                  <InfoCard
                    title="Who the site serves"
                    detail={
                      recommendation.audience ||
                      "Prospective residents seeking practical property information."
                    }
                  />
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Pages</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {recommendation.pages.map((page) => (
                        <div key={page.name}>
                          <p className="text-sm font-medium">{page.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {page.purpose}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Priorities</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                      {recommendation.priorities.map((item) => (
                        <p key={item} className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          {item}
                        </p>
                      ))}
                    </CardContent>
                  </Card>
                </div>
                <div className="flex justify-between gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setActiveStep("conversation")}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" /> Review answers
                  </Button>
                  <Button
                    onClick={() => void confirmRecommendation()}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Build this site
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyStep
                title="Prepare a recommendation first"
                detail="Finish discovery and review visuals before SiteForge checkpoints a build plan."
                action="Review visuals"
                onAction={() => setActiveStep("visuals")}
              />
            )
          ) : null}

          {activeStep === "build" ? (
            projection?.blocker ? (
              <EmptyStep
                title={projection.headline}
                detail={projection.explanation}
                action={
                  projection.retryable && retryCommand
                    ? "Retry this build"
                    : "Review recommendation"
                }
                onAction={() => {
                  if (projection.retryable && retryCommand) {
                    void retryBuild(retryCommand);
                  } else {
                    setActiveStep("recommendation");
                  }
                }}
              />
            ) : (
              <EmptyStep
                title={
                  state?.generation
                    ? "Your build is safely underway"
                    : "Build starts from the approved recommendation"
                }
                detail="The Build this site action creates a private revision and never publishes it automatically."
                action={
                  state?.generation ? "View progress" : "Review recommendation"
                }
                onAction={() =>
                  setActiveStep(state?.generation ? "progress" : "recommendation")
                }
              />
            )
          ) : null}

          {activeStep === "progress" ? (
            <ProgressStep
              snapshot={director}
              busy={busy || refreshing}
              retryAvailable={Boolean(retryCommand)}
              onRefresh={() => void refreshAll()}
              onRetry={() => retryCommand && void retryBuild(retryCommand)}
              onPreview={() => setActiveStep("preview")}
            />
          ) : null}

          {activeStep === "preview" ? (
            hasArtifact ? (
              <div className="space-y-4">
                <StepHeading
                  eyebrow="Preview and edit"
                  title="Review the private website revision"
                  description="Inspect every page and request conversational edits. Accepted changes create safe revisions before launch."
                />
                <EditorWorkspace
                  websiteId={websiteId}
                  propertyId={propertyId}
                />
                <div className="flex justify-end">
                  <Button onClick={() => setActiveStep("launch")}>
                    Continue to launch <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyStep
                title="Preview unlocks after the build"
                detail="SiteForge is still creating the first reviewable revision."
                action="View progress"
                onAction={() => setActiveStep("progress")}
              />
            )
          ) : null}

          {activeStep === "launch" ? (
            hasArtifact ? (
              <div className="space-y-4">
                <StepHeading
                  eyebrow="Launch"
                  title="Publish with a supervised handoff"
                  description="Approve the exact staging revision and retain production monitoring and recovery controls."
                />
                <LaunchWorkspace websiteId={websiteId} />
              </div>
            ) : (
              <EmptyStep
                title="Launch unlocks after preview"
                detail="Nothing can publish before a reviewable website revision exists."
                action="View progress"
                onAction={() => setActiveStep("progress")}
              />
            )
          ) : null}
        </section>
      )}

      <details className="group rounded-xl border bg-muted/20">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold">
          Advanced diagnostics
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t p-4 sm:p-6">
          <p className="mb-5 text-sm text-muted-foreground">
            Read-only support information for the current guided journey.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DiagnosticValue
              label="Journey stage"
              value={director?.stage.label || "Loading"}
            />
            <DiagnosticValue
              label="Status"
              value={director?.stage.status || "unknown"}
            />
            <DiagnosticValue
              label="Build progress"
              value={`${progressPercent(director)}%`}
            />
            <DiagnosticValue
              label="Artifact"
              value={
                director?.artifact.current.version
                  ? `Revision ${director.artifact.current.version}`
                  : "Not created"
              }
            />
          </div>
          {director?.blockers.length ? (
            <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
              <p className="text-sm font-semibold">Needs attention</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {director.blockers.map(blocker => (
                  <li key={`${blocker.code}-${blocker.entityId || ""}`}>
                    {blocker.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </main>
  );
}

function DiagnosticValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize">{value}</p>
    </div>
  );
}

function ConversationStep({
  state,
  question,
  draft,
  attachments,
  referenceUrl,
  busy,
  onDraftChange,
  onReferenceUrlChange,
  onAddReference,
  onRemoveAttachment,
  onDocuments,
  onSend,
  onVisuals,
}: {
  state: GuidedJourneyState | null;
  question: GuidedQuestion | null;
  draft: string;
  attachments: GuidedAttachment[];
  referenceUrl: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onReferenceUrlChange: (value: string) => void;
  onAddReference: () => void;
  onRemoveAttachment: (index: number) => void;
  onDocuments: (files: FileList | null) => void;
  onSend: () => void;
  onVisuals: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader className="border-b bg-muted/20">
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            Property discovery
          </CardTitle>
          <CardDescription>
            One current question is accepted at a time; every answer is
            revision-safe and resumable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          {state?.turns.length ? (
            <div
              className="max-h-72 space-y-3 overflow-y-auto"
              aria-live="polite"
            >
              {state.turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${turn.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                >
                  {turn.content}
                </div>
              ))}
            </div>
          ) : null}
          <div className="rounded-xl border border-primary/40 bg-accent p-4 text-accent-foreground">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Current question
            </p>
            <p className="mt-2 font-medium">
              {question?.question || "Discovery is complete."}
            </p>
            {question ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {question.why}
                {question.optional ? " You can answer “none”." : ""}
              </p>
            ) : null}
          </div>
          {question ? (
            <>
              <Textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSend();
                  }
                }}
                placeholder={
                  question.optional
                    ? "Answer, or type “none”…"
                    : "Answer in your own words…"
                }
                className="min-h-28"
                disabled={busy}
                aria-label="Answer current SiteForge question"
              />
              {attachments.length ? (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment, index) => (
                    <button
                      key={`${attachment.kind}-${attachment.name}-${index}`}
                      type="button"
                      className="rounded-full border px-3 py-1 text-xs"
                      onClick={() => onRemoveAttachment(index)}
                      aria-label={`Remove attachment ${attachment.name}`}
                      title={`Remove ${attachment.name}`}
                    >
                      {attachment.name} ×
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <input
                  type="url"
                  value={referenceUrl}
                  onChange={(event) => onReferenceUrlChange(event.target.value)}
                  placeholder="https://reference.example"
                  className="h-9 min-w-48 flex-1 rounded-md border bg-background px-3 text-sm"
                  aria-label="Reference URL"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onAddReference}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  Add link
                </Button>
                <label className="inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm">
                  <FileText className="mr-2 h-4 w-4" />
                  Document
                  <input
                    className="sr-only"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md"
                    onChange={(event) => {
                      onDocuments(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <div className="flex-1" />
                <Button
                  onClick={onSend}
                  disabled={
                    busy ||
                    (!draft.trim() &&
                      !(
                        question.field === "references" &&
                        attachments.length > 0
                      ))
                  }
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send answer
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={onVisuals}>
              Review photos and floor plans
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <InfoCard
          title="Saved progress"
          detail={`Revision ${state?.revision ?? 0}. Return any time to resume the latest server-side conversation.`}
        />
        <InfoCard
          title="Source guardrails"
          detail="Verified property and brand truth is pinned again when the recommendation is prepared."
        />
      </div>
    </div>
  );
}

function ProgressStep({
  snapshot,
  busy,
  retryAvailable,
  onRefresh,
  onRetry,
  onPreview,
}: {
  snapshot: SiteForgeDirectorSnapshot | null;
  busy: boolean;
  retryAvailable: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onPreview: () => void;
}) {
  const latest = snapshot?.jobs.find(
    (job) => job.domain === "siteforge.generation",
  );
  const hasArtifact = Boolean(snapshot?.artifact.current.artifactId);
  const failed =
    ["failed", "cancelled"].includes(latest?.lifecycleStatus || "") ||
    snapshot?.stage.status === "blocked";
  const progress = progressPercent(snapshot);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <StepHeading
        eyebrow="Progress"
        title={
          hasArtifact
            ? "Your website is ready to review"
            : failed
              ? "The build needs attention"
              : "SiteForge is building your website"
        }
        description={
          failed
            ? latest?.failureReason ||
              "Nothing was published. Review the approved inputs before the next attempt."
            : "You can leave and return; durable progress resumes automatically."
        }
      />
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div>
            <div className="mb-2 flex justify-between text-sm">
              <span>
                {hasArtifact
                  ? "Website ready"
                  : plainSiteForgeProgress(latest?.stage, latest?.currentStep)}
              </span>
              <span>{progress}%</span>
            </div>
            <div
              className="h-3 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Website build progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-valuetext={`${progress}% — ${
                hasArtifact
                  ? "Website ready"
                  : plainSiteForgeProgress(latest?.stage, latest?.currentStep)
              }`}
            >
              <div
                className={`h-full ${failed ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onRefresh} disabled={busy}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Check progress
            </Button>
            {failed && retryAvailable ? (
              <Button onClick={onRetry} disabled={busy}>
                Retry build
              </Button>
            ) : null}
            {hasArtifact ? (
              <Button onClick={onPreview}>
                Open preview and editor
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-primary">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function InfoCard({ title, detail }: { title: string; detail: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function EmptyStep({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <Card className="mx-auto max-w-2xl border-dashed text-center">
      <CardContent className="px-6 py-14">
        <Sparkles className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-4 text-xl font-semibold">{title}</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          {detail}
        </p>
        <Button className="mt-5" onClick={onAction}>
          {action}
        </Button>
      </CardContent>
    </Card>
  );
}
