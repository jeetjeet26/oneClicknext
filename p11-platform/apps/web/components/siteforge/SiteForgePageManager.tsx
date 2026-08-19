'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { SiteBlueprint } from '@/types/siteforge'
import {
  inspectSiteForgeManagedPages,
  type SiteForgePageManagerAction,
} from '@/utils/siteforge/editor/page-manager'

const inputClassName =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

type EditDraft = {
  pageSlug: string
  slug: string
  title: string
  purpose: string
  seoTitle: string
  seoDescription: string
  noIndex: boolean
  navigationVisible: boolean
  navigationLabel: string
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

export function SiteForgePageManager({
  blueprint,
  disabled,
  authorized,
  onApply,
  onSelectPage,
}: {
  blueprint: SiteBlueprint
  disabled: boolean
  authorized: boolean
  onApply: (action: SiteForgePageManagerAction) => Promise<void>
  onSelectPage: (slug: string) => void
}) {
  const pages = inspectSiteForgeManagedPages(blueprint)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<EditDraft | null>(null)
  const [removingSlug, setRemovingSlug] = useState<string | null>(null)
  const [redirectToSlug, setRedirectToSlug] = useState('home')
  const [localError, setLocalError] = useState<string | null>(null)
  const [addDraft, setAddDraft] = useState({
    title: '',
    slug: '',
    purpose: '',
    visitorIntent: '',
    seoTitle: '',
    seoDescription: '',
    navigationVisible: true,
    navigationLabel: '',
  })

  async function apply(action: SiteForgePageManagerAction) {
    setLocalError(null)
    try {
      await onApply(action)
      setAdding(false)
      setEditing(null)
      setRemovingSlug(null)
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : 'Page operation failed'
      )
    }
  }

  function beginEdit(page: (typeof pages)[number]) {
    setRemovingSlug(null)
    setEditing({
      pageSlug: page.slug,
      slug: page.slug,
      title: page.title,
      purpose: page.purpose,
      seoTitle: page.seo?.title || page.title,
      seoDescription: page.seo?.description || '',
      noIndex: page.seo?.noIndex || false,
      navigationVisible: page.navigation.visible,
      navigationLabel: page.navigation.label,
    })
  }

  async function submitEdit() {
    if (!editing) return
    const page = pages.find(candidate => candidate.slug === editing.pageSlug)
    if (!page) return
    const action: Extract<SiteForgePageManagerAction, { type: 'update' }> = {
      type: 'update',
      pageSlug: page.slug,
      ...(editing.slug !== page.slug ? { slug: editing.slug } : {}),
      ...(editing.title !== page.title ? { title: editing.title } : {}),
      ...(editing.purpose !== page.purpose
        ? { purpose: editing.purpose }
        : {}),
      ...(editing.seoTitle !== page.seo?.title ||
      editing.seoDescription !== page.seo?.description ||
      editing.noIndex !== (page.seo?.noIndex || false)
        ? {
            seo: {
              title: editing.seoTitle,
              description: editing.seoDescription,
              noIndex: editing.noIndex,
            },
          }
        : {}),
      ...(editing.navigationVisible !== page.navigation.visible ||
      editing.navigationLabel !== page.navigation.label
        ? {
            navigation: {
              visible: editing.navigationVisible,
              label: editing.navigationLabel,
            },
          }
        : {}),
    }
    if (Object.keys(action).length === 2) {
      setLocalError('Change at least one page field before saving')
      return
    }
    await apply(action)
  }

  async function submitAdd() {
    await apply({
      type: 'add',
      title: addDraft.title.trim(),
      slug: addDraft.slug.trim(),
      purpose: addDraft.purpose.trim(),
      visitorIntent: addDraft.visitorIntent.trim(),
      ...(addDraft.seoTitle.trim() || addDraft.seoDescription.trim()
        ? {
            seo: {
              ...(addDraft.seoTitle.trim()
                ? { title: addDraft.seoTitle.trim() }
                : {}),
              ...(addDraft.seoDescription.trim()
                ? { description: addDraft.seoDescription.trim() }
                : {}),
            },
          }
        : {}),
      navigation: {
        visible: addDraft.navigationVisible,
        ...(addDraft.navigationLabel.trim()
          ? { label: addDraft.navigationLabel.trim() }
          : {}),
      },
    })
    setAddDraft({
      title: '',
      slug: '',
      purpose: '',
      visitorIntent: '',
      seoTitle: '',
      seoDescription: '',
      navigationVisible: true,
      navigationLabel: '',
    })
  }

  const controlsDisabled = disabled || !authorized

  return (
    <section
      aria-labelledby="siteforge-page-manager-heading"
      className="space-y-3 rounded-lg border bg-muted/20 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="siteforge-page-manager-heading" className="text-sm font-semibold">
            Page manager
          </h2>
          <p className="text-xs text-muted-foreground">
            Structured operations create immutable revisions. Legal pages and
            duplicate slugs are protected server-side.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={adding ? 'secondary' : 'outline'}
          disabled={controlsDisabled}
          onClick={() => {
            setAdding(current => !current)
            setEditing(null)
            setRemovingSlug(null)
            setLocalError(null)
          }}
        >
          {adding ? 'Close add form' : 'Add page'}
        </Button>
      </div>

      {!authorized ? (
        <p role="alert" className="text-xs text-destructive">
          SiteForge owner/operator capability is required to manage pages.
        </p>
      ) : null}

      {adding ? (
        <div className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="page-manager-add-title">Page title</Label>
            <input
              id="page-manager-add-title"
              className={inputClassName}
              value={addDraft.title}
              disabled={controlsDisabled}
              onChange={event => {
                const title = event.target.value
                setAddDraft(current => ({
                  ...current,
                  title,
                  slug:
                    current.slug === slugify(current.title)
                      ? slugify(title)
                      : current.slug,
                }))
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="page-manager-add-slug">Public slug</Label>
            <input
              id="page-manager-add-slug"
              className={inputClassName}
              value={addDraft.slug}
              disabled={controlsDisabled}
              onChange={event =>
                setAddDraft(current => ({
                  ...current,
                  slug: slugify(event.target.value),
                }))
              }
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="page-manager-add-purpose">Page purpose</Label>
            <Textarea
              id="page-manager-add-purpose"
              value={addDraft.purpose}
              disabled={controlsDisabled}
              onChange={event =>
                setAddDraft(current => ({
                  ...current,
                  purpose: event.target.value,
                }))
              }
              placeholder="What this page must accomplish"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="page-manager-add-intent">Visitor intent</Label>
            <Textarea
              id="page-manager-add-intent"
              value={addDraft.visitorIntent}
              disabled={controlsDisabled}
              onChange={event =>
                setAddDraft(current => ({
                  ...current,
                  visitorIntent: event.target.value,
                }))
              }
              placeholder="What should a visitor understand or do on this page?"
            />
            <p className="text-xs text-muted-foreground">
              SiteForge composes governed sections from this intent; the final
              mutation is a validated structured operation set.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="page-manager-add-seo-title">SEO title</Label>
            <input
              id="page-manager-add-seo-title"
              className={inputClassName}
              value={addDraft.seoTitle}
              disabled={controlsDisabled}
              maxLength={60}
              onChange={event =>
                setAddDraft(current => ({
                  ...current,
                  seoTitle: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="page-manager-add-nav-label">Navigation label</Label>
            <input
              id="page-manager-add-nav-label"
              className={inputClassName}
              value={addDraft.navigationLabel}
              disabled={controlsDisabled || !addDraft.navigationVisible}
              maxLength={80}
              onChange={event =>
                setAddDraft(current => ({
                  ...current,
                  navigationLabel: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="page-manager-add-seo-description">
              SEO description
            </Label>
            <Textarea
              id="page-manager-add-seo-description"
              value={addDraft.seoDescription}
              disabled={controlsDisabled}
              maxLength={160}
              onChange={event =>
                setAddDraft(current => ({
                  ...current,
                  seoDescription: event.target.value,
                }))
              }
              placeholder="Optional; 50–160 characters when supplied"
            />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={addDraft.navigationVisible}
              disabled={controlsDisabled}
              onChange={event =>
                setAddDraft(current => ({
                  ...current,
                  navigationVisible: event.target.checked,
                }))
              }
            />
            Show in primary navigation
          </label>
          <div className="flex justify-end md:col-span-2">
            <Button
              type="button"
              size="sm"
              disabled={
                controlsDisabled ||
                !addDraft.title.trim() ||
                !addDraft.slug.trim() ||
                addDraft.purpose.trim().length < 10 ||
                addDraft.visitorIntent.trim().length < 10 ||
                Boolean(
                  addDraft.seoDescription.trim() &&
                    addDraft.seoDescription.trim().length < 50
                )
              }
              onClick={() => void submitAdd()}
            >
              Add governed page
            </Button>
          </div>
        </div>
      ) : null}

      <ol className="space-y-2">
        {pages.map((page, index) => (
          <li key={page.slug} className="rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectPage(page.slug)}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">{page.title}</strong>
                  <Badge variant="outline">/{page.slug}</Badge>
                  {page.navigation.visible ? (
                    <Badge variant="secondary">Navigation</Badge>
                  ) : null}
                  {page.legal ? (
                    <Badge variant="outline">Required legal</Badge>
                  ) : null}
                </span>
                <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                  {page.purpose}
                </span>
              </button>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Move ${page.title} up`}
                  disabled={controlsDisabled || index === 0}
                  onClick={() =>
                    void apply({
                      type: 'move',
                      pageSlug: page.slug,
                      toOrder: index,
                    })
                  }
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Move ${page.title} down`}
                  disabled={controlsDisabled || index === pages.length - 1}
                  onClick={() =>
                    void apply({
                      type: 'move',
                      pageSlug: page.slug,
                      toOrder: index + 2,
                    })
                  }
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={controlsDisabled || page.legal}
                  onClick={() => beginEdit(page)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={controlsDisabled || page.required}
                  onClick={() => {
                    setRemovingSlug(page.slug)
                    setRedirectToSlug(
                      pages.find(candidate => candidate.slug !== page.slug)
                        ?.slug || 'home'
                    )
                    setEditing(null)
                    setAdding(false)
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>

            {editing?.pageSlug === page.slug ? (
              <div className="mt-3 grid gap-3 border-t pt-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`page-title-${page.slug}`}>Title</Label>
                  <input
                    id={`page-title-${page.slug}`}
                    className={inputClassName}
                    value={editing.title}
                    disabled={controlsDisabled}
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? { ...current, title: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`page-slug-${page.slug}`}>Slug</Label>
                  <input
                    id={`page-slug-${page.slug}`}
                    className={inputClassName}
                    value={editing.slug}
                    disabled={controlsDisabled || page.slug === 'home'}
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? { ...current, slug: slugify(event.target.value) }
                          : current
                      )
                    }
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor={`page-purpose-${page.slug}`}>Purpose</Label>
                  <Textarea
                    id={`page-purpose-${page.slug}`}
                    value={editing.purpose}
                    disabled={controlsDisabled}
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? { ...current, purpose: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`page-seo-title-${page.slug}`}>
                    SEO title
                  </Label>
                  <input
                    id={`page-seo-title-${page.slug}`}
                    className={inputClassName}
                    maxLength={60}
                    value={editing.seoTitle}
                    disabled={controlsDisabled}
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? { ...current, seoTitle: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`page-nav-label-${page.slug}`}>
                    Navigation label
                  </Label>
                  <input
                    id={`page-nav-label-${page.slug}`}
                    className={inputClassName}
                    maxLength={80}
                    value={editing.navigationLabel}
                    disabled={
                      controlsDisabled || !editing.navigationVisible
                    }
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? {
                              ...current,
                              navigationLabel: event.target.value,
                            }
                          : current
                      )
                    }
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor={`page-seo-description-${page.slug}`}>
                    SEO description
                  </Label>
                  <Textarea
                    id={`page-seo-description-${page.slug}`}
                    value={editing.seoDescription}
                    disabled={controlsDisabled}
                    maxLength={160}
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? {
                              ...current,
                              seoDescription: event.target.value,
                            }
                          : current
                      )
                    }
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.navigationVisible}
                    disabled={controlsDisabled}
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? {
                              ...current,
                              navigationVisible: event.target.checked,
                            }
                          : current
                      )
                    }
                  />
                  Show in primary navigation
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.noIndex}
                    disabled={controlsDisabled}
                    onChange={event =>
                      setEditing(current =>
                        current
                          ? { ...current, noIndex: event.target.checked }
                          : current
                      )
                    }
                  />
                  Exclude from search indexing
                </label>
                <div className="flex justify-end gap-2 md:col-span-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      controlsDisabled ||
                      !editing.slug ||
                      !editing.title.trim() ||
                      !editing.purpose.trim() ||
                      !editing.seoTitle.trim() ||
                      editing.seoDescription.trim().length < 50
                    }
                    onClick={() => void submitEdit()}
                  >
                    Publish page update
                  </Button>
                </div>
              </div>
            ) : null}

            {removingSlug === page.slug ? (
              <div className="mt-3 space-y-3 border-t pt-3">
                <p className="text-sm font-medium">
                  Remove /{page.slug} and preserve its public URL
                </p>
                <div className="space-y-1">
                  <Label htmlFor={`page-redirect-${page.slug}`}>
                    Permanent redirect destination
                  </Label>
                  <Select
                    id={`page-redirect-${page.slug}`}
                    value={redirectToSlug}
                    disabled={controlsDisabled}
                    onValueChange={setRedirectToSlug}
                  >
                    {pages
                      .filter(candidate => candidate.slug !== page.slug)
                      .map(candidate => (
                        <SelectItem
                          key={candidate.slug}
                          value={candidate.slug}
                        >
                          {candidate.title} (/{candidate.slug})
                        </SelectItem>
                      ))}
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Internal links, primary navigation, and global CTA links are
                  rebound to this destination in the same immutable revision.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setRemovingSlug(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={controlsDisabled || !redirectToSlug}
                    onClick={() =>
                      void apply({
                        type: 'remove',
                        pageSlug: page.slug,
                        redirectToSlug,
                      })
                    }
                  >
                    Remove with redirect
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {localError ? (
        <p role="alert" className="text-xs text-destructive">
          {localError}
        </p>
      ) : null}
    </section>
  )
}
