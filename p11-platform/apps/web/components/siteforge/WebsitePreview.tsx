'use client'

// SiteForge: Website Preview Component
// Shows generated site structure and content
// Created: December 11, 2025

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DesignSystem } from './ACFBlockRenderer'
import type { GeneratedPage, SiteConfiguration, WebsiteStatusResponse } from '@/types/siteforge'
import {
  classifyWebsiteStatus,
  isExactArtifactPreview,
  regenerationPlanUrl,
  responseErrorMessage,
  siteForgeStatusEndpoint,
} from './orchestration'

type WebsitePreviewData = {
  websiteId: string
  property?: ({ id?: string; name?: string } & Record<string, unknown>) | null
  generationStatus?: string
  brandSource?: string
  brandConfidence?: number
  brandReadiness?: WebsiteStatusResponse['brandReadiness']
  deploymentReadiness?: WebsiteStatusResponse['deploymentReadiness']
  siteArchitecture?: {
    designDecisions?: {
      colorStrategy?: string
      imageStrategy?: string
      contentDensity?: string
      conversionOptimization?: string[]
    }
    designSystem?: DesignSystem
  } | null
  designSystem?: DesignSystem
  siteBlueprint?: {
    siteConfiguration?: SiteConfiguration
    propertySnapshot?: unknown
    legal?: unknown
  } | null
  pagesGenerated?: GeneratedPage[]
  assets?: unknown[]
  artifact?: {
    currentId?: string | null
    canonicalPreviewUrl?: string | null
    canonicalPreviewArtifactId?: string | null
    canonicalPreviewContentHash?: string | null
    deployedArtifactId?: string | null
    deployedContentHash?: string | null
    history: Array<{
      id: string
      version: number
      content_hash: string
      parent_version_id?: string | null
      change_type: string
      changes_summary?: string | null
      quality_score?: number | null
      quality_report?: unknown
      created_at: string
      deployment_decision?: string | null
      deployment_approved_at?: string | null
    }>
  }
  deploymentDiagnostics?: WebsiteStatusResponse['deploymentDiagnostics']
  wpUrl?: string
  wpAdminUrl?: string
  createdAt?: string
  completedAt?: string
}

interface WebsitePreviewProps {
  websiteId: string
  readOnly?: boolean
}

type RollbackPreview = {
  canRollback: boolean
  currentArtifact?: {
    id: string
    version: number
    content_hash: string
  } | null
  rollbackToVersion?: number
  rollbackToArtifactId?: string
  rollbackToContentHash?: string
  message?: string
}

type PreviewLink = {
  label: string
  href: string
  external: boolean
}

export type PreviewNavigationNode = SiteConfiguration['navigation']['items'][number] & {
  children: PreviewNavigationNode[]
}

export type SiteChromeModel = {
  brandName?: string
  phone?: string
  email?: string
  address?: string
  socialLinks: PreviewLink[]
  legalLinks: PreviewLink[]
  footerText?: string
}

function previewRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function previewString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  )?.trim()
}

function humanizeLinkLabel(value: string): string {
  return value
    .replace(/(?:Path|Url|URL|Link)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase())
}

function isExternalLink(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

function normalizePreviewLinks(value: unknown): PreviewLink[] {
  if (Array.isArray(value)) {
    return value.flatMap(entry => {
      const record = previewRecord(entry)
      const href = previewString(record.href, record.url, record.path)
      const label = previewString(record.label, record.text, record.name)
      if (!href || !label) return []
      return [
        {
          href,
          label,
          external:
            typeof record.external === 'boolean'
              ? record.external
              : isExternalLink(href),
        },
      ]
    })
  }

  return Object.entries(previewRecord(value)).flatMap(([key, entry]) => {
    const record = previewRecord(entry)
    const href =
      typeof entry === 'string'
        ? previewString(entry)
        : previewString(record.href, record.url, record.path)
    if (!href) return []
    return [
      {
        href,
        label: previewString(record.label, record.text) || humanizeLinkLabel(key),
        external: isExternalLink(href),
      },
    ]
  })
}

function formatPreviewAddress(value: unknown): string | undefined {
  if (typeof value === 'string') return previewString(value)
  const address = previewRecord(value)
  const parts = [
    previewString(address.street, address.address1, address.line1),
    previewString(address.street2, address.address2, address.line2),
    previewString(address.city),
    previewString(address.state, address.region),
    previewString(address.zip, address.postalCode),
    previewString(address.country),
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : undefined
}

export function buildSiteChromeModel(
  configuration: SiteConfiguration,
  fallbackProfile?: unknown,
  legalSource?: unknown
): SiteChromeModel {
  const raw = configuration as SiteConfiguration & Record<string, unknown>
  const brand = previewRecord(raw.brand)
  const identity = previewRecord(raw.identity)
  const contact = previewRecord(raw.contact)
  const configuredProfile = previewRecord(raw.propertyProfile)
  const profile = {
    ...previewRecord(fallbackProfile),
    ...configuredProfile,
    ...contact,
  }
  const footer = raw.footer as SiteConfiguration['footer'] &
    Record<string, unknown>
  const legal = {
    ...previewRecord(legalSource),
    ...previewRecord(raw.legal),
  }
  const legalPaths =
    previewRecord(legal.paths)
  const legalLinks =
    normalizePreviewLinks(raw.legalLinks).length > 0
      ? normalizePreviewLinks(raw.legalLinks)
      : normalizePreviewLinks(footer.legalLinks).length > 0
        ? normalizePreviewLinks(footer.legalLinks)
        : normalizePreviewLinks(
            Object.keys(legalPaths).length > 0 ? legalPaths : legal.links
          )

  return {
    brandName: previewString(
      raw.brandName,
      brand.name,
      identity.name,
      configuredProfile.name,
      previewRecord(fallbackProfile).name
    ),
    phone: previewString(profile.phone),
    email: previewString(profile.email),
    address: formatPreviewAddress(profile.address),
    socialLinks: normalizePreviewLinks(
      raw.socialLinks || configuredProfile.socialLinks || profile.socialLinks
    ),
    legalLinks,
    footerText: previewString(
      footer.text,
      footer.footerText,
      footer.copyrightText,
      raw.footerText,
      legal.fairHousingDisclaimer
    ),
  }
}

export function buildPreviewNavigation(
  items: SiteConfiguration['navigation']['items']
): PreviewNavigationNode[] {
  const childrenByParent = new Map<string, SiteConfiguration['navigation']['items']>()
  const knownIds = new Set(items.map(item => item.id))
  const visited = new Set<string>()

  items.forEach(item => {
    if (!item.parentId || item.parentId === item.id || !knownIds.has(item.parentId)) {
      return
    }
    const siblings = childrenByParent.get(item.parentId) || []
    siblings.push(item)
    childrenByParent.set(item.parentId, siblings)
  })

  const buildNode = (
    item: SiteConfiguration['navigation']['items'][number],
    ancestors: Set<string>
  ): PreviewNavigationNode => {
    visited.add(item.id)
    const nextAncestors = new Set(ancestors).add(item.id)
    return {
      ...item,
      children: (childrenByParent.get(item.id) || [])
        .filter(child => !nextAncestors.has(child.id) && !visited.has(child.id))
        .map(child => buildNode(child, nextAncestors)),
    }
  }

  const roots = items
    .filter(
      item =>
        !item.parentId ||
        item.parentId === item.id ||
        !knownIds.has(item.parentId)
    )
    .map(item => buildNode(item, new Set()))

  items.forEach(item => {
    if (!visited.has(item.id)) {
      roots.push(buildNode(item, new Set()))
    }
  })

  return roots
}

function previewAnchorProps(
  href: string,
  external: boolean,
  externalLinksNewTab: boolean
) {
  return external && externalLinksNewTab
    ? { target: '_blank' as const, rel: 'noopener noreferrer' }
    : {}
}

function PreviewNavigationList({
  nodes,
  externalLinksNewTab,
  className,
}: {
  nodes: PreviewNavigationNode[]
  externalLinksNewTab: boolean
  className?: string
}) {
  return (
    <ul className={className}>
      {nodes.map(node => (
        <li key={node.id}>
          <a
            href={node.href}
            {...previewAnchorProps(
              node.href,
              node.external ?? isExternalLink(node.href),
              externalLinksNewTab
            )}
            className="underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {node.label}
          </a>
          {node.children.length > 0 ? (
            <PreviewNavigationList
              nodes={node.children}
              externalLinksNewTab={externalLinksNewTab}
              className="mt-2 space-y-2 border-l border-current/25 pl-3"
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function SitePreviewHeader({
  configuration,
  chrome,
}: {
  configuration: SiteConfiguration
  chrome: SiteChromeModel
}) {
  const navigation = buildPreviewNavigation(configuration.navigation.items)
  const announcement = configuration.header.announcement
  const cta = configuration.header.cta
  const openExternal = configuration.behavior.externalLinksNewTab

  return (
    <header
      className="border-b border-current/15"
      data-layout={configuration.header.layout}
      data-requested-position={configuration.header.position}
    >
      {announcement.enabled && announcement.text ? (
        <div
          className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-widest"
          style={{
            color: configuration.design.colors.background,
            background: configuration.design.colors.primary,
          }}
        >
          {announcement.link ? (
            <a
              href={announcement.link}
              {...previewAnchorProps(
                announcement.link,
                isExternalLink(announcement.link),
                openExternal
              )}
              className="underline-offset-4 hover:underline"
            >
              {announcement.text}
            </a>
          ) : (
            announcement.text
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-5 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {configuration.media.logoUrl ? (
            // The preview supports user-managed asset URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={configuration.media.logoUrl}
              alt={configuration.media.logoAlt || ''}
              className="max-h-12 max-w-48 object-contain"
              decoding="async"
            />
          ) : null}
          {chrome.brandName ? (
            <span
              className="text-lg font-semibold"
              style={{
                fontFamily: configuration.design.typography.headingFont,
              }}
            >
              {chrome.brandName}
            </span>
          ) : null}
        </div>
        {navigation.length > 0 ? (
          <nav aria-label="Primary preview navigation">
            <PreviewNavigationList
              nodes={navigation}
              externalLinksNewTab={openExternal}
              className="flex flex-wrap items-start gap-x-4 gap-y-2 text-sm"
            />
          </nav>
        ) : null}
        {cta.enabled ? (
          <a
            href={cta.href}
            {...previewAnchorProps(cta.href, isExternalLink(cta.href), openExternal)}
            className="rounded px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              color: configuration.design.colors.background,
              background: configuration.design.colors.primary,
            }}
          >
            {cta.label}
          </a>
        ) : null}
      </div>
    </header>
  )
}

export function SitePreviewFooter({
  configuration,
  chrome,
}: {
  configuration: SiteConfiguration
  chrome: SiteChromeModel
}) {
  const navigation = buildPreviewNavigation(configuration.navigation.items)
  const openExternal = configuration.behavior.externalLinksNewTab
  const phoneHref = chrome.phone?.replace(/[^\d+]/g, '')

  return (
    <footer
      className="px-6 py-8"
      data-layout={configuration.footer.layout}
      style={{
        color: configuration.design.colors.background,
        background: configuration.design.colors.primary,
      }}
    >
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {(configuration.media.logoUrl ||
          chrome.brandName ||
          chrome.address ||
          configuration.footer.tagline) && (
          <div>
            {configuration.media.logoUrl ? (
              // The preview supports user-managed asset URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={configuration.media.logoUrl}
                alt={configuration.media.logoAlt || ''}
                className="mb-3 max-h-12 max-w-48 object-contain"
                loading="lazy"
                decoding="async"
              />
            ) : null}
            {chrome.brandName ? (
              <p style={{ fontFamily: configuration.design.typography.headingFont }}>
                {chrome.brandName}
              </p>
            ) : null}
            {configuration.footer.tagline ? (
              <p className="mt-2 text-sm opacity-80">
                {configuration.footer.tagline}
              </p>
            ) : null}
            {chrome.address ? (
              <address className="mt-2 whitespace-pre-line text-sm not-italic opacity-80">
                {chrome.address}
              </address>
            ) : null}
          </div>
        )}
        {configuration.footer.showContact && (chrome.phone || chrome.email) ? (
          <div>
            <p className="font-semibold">Contact</p>
            <ul className="mt-2 space-y-2 text-sm">
              {chrome.phone ? (
                <li>
                  {phoneHref ? <a href={`tel:${phoneHref}`}>{chrome.phone}</a> : chrome.phone}
                </li>
              ) : null}
              {chrome.email ? (
                <li>
                  <a href={`mailto:${chrome.email}`}>{chrome.email}</a>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {configuration.footer.showNavigation && navigation.length > 0 ? (
          <nav aria-label="Footer preview navigation">
            <PreviewNavigationList
              nodes={navigation}
              externalLinksNewTab={openExternal}
              className="space-y-2 text-sm"
            />
          </nav>
        ) : null}
        {configuration.footer.showSocial && chrome.socialLinks.length > 0 ? (
          <nav aria-label="Social links">
            <ul className="space-y-2 text-sm">
              {chrome.socialLinks.map(link => (
                <li key={`${link.label}-${link.href}`}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${link.label} (opens in a new tab)`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      {(chrome.legalLinks.length > 0 || chrome.footerText) && (
        <div className="mt-8 border-t border-current/25 pt-4 text-sm">
          {chrome.legalLinks.length > 0 ? (
            <nav aria-label="Legal links">
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {chrome.legalLinks.map(link => (
                  <li key={`${link.label}-${link.href}`}>
                    <a
                      href={link.href}
                      {...previewAnchorProps(
                        link.href,
                        link.external,
                        openExternal
                      )}
                      className="underline-offset-4 hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {chrome.footerText ? <p className="mt-3">{chrome.footerText}</p> : null}
        </div>
      )}
    </footer>
  )
}

function getDeterministicQualityChecks(value: unknown): Array<{
  id: string
  passed: boolean
  message: string
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const deterministic = (value as Record<string, unknown>).deterministic
  if (
    !deterministic ||
    typeof deterministic !== 'object' ||
    Array.isArray(deterministic)
  ) {
    return []
  }
  const checks = (deterministic as Record<string, unknown>).checks
  if (!Array.isArray(checks)) return []
  return checks.flatMap((check) =>
    check &&
    typeof check === 'object' &&
    !Array.isArray(check) &&
    typeof check.id === 'string' &&
    typeof check.passed === 'boolean' &&
    typeof check.message === 'string'
      ? [
          {
            id: check.id,
            passed: check.passed,
            message: check.message,
          },
        ]
      : []
  )
}

function getDeploymentRemediationTips(
  diagnostics: WebsiteStatusResponse['deploymentDiagnostics']
): string[] {
  if (!diagnostics) {
    return []
  }

  if (diagnostics.status === 'success') {
    return ['Deployment is verified. Open the live site and spot-check hero content, media, and navigation.']
  }

  const category = diagnostics.error?.category
  if (category === 'verification') {
    return [
      'Confirm required WordPress namespaces are available (wp/v2 and configured ACF/Yoast requirements).',
      'Check that generated pages were published and are reachable via /wp-json/wp/v2/pages.',
      'Re-run deployment after fixing missing pages, media uploads, or site settings permissions.',
    ]
  }

  if (category === 'configuration') {
    return [
      'Verify deployment credentials are set (Cloudways keys or existing WordPress URL + app password).',
      'Confirm WordPress credentials have API access and can read/write pages and settings.',
      'Retry deployment after updating environment variables and restarting local services.',
    ]
  }

  if (category === 'provisioning') {
    return [
      'Check Cloudways API availability, key permissions, and region/instance limits.',
      'Review Cloudways operation status for server/app provisioning delays or failures.',
      'Retry deployment once Cloudways provisioning completes successfully.',
    ]
  }

  return [
    'Review deployment diagnostics and server logs for the first failing step.',
    'Validate WordPress and provider credentials, then retry deployment.',
  ]
}

export function WebsitePreview({ websiteId, readOnly = false }: WebsitePreviewProps) {
  const [website, setWebsite] = useState<WebsitePreviewData | null>(null)
  const [selectedPage, setSelectedPage] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false)
  const [rollbackPreviewLoading, setRollbackPreviewLoading] = useState(false)
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deploymentDiagnostics, setDeploymentDiagnostics] = useState<
    WebsiteStatusResponse['deploymentDiagnostics']
  >()
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [editInstruction, setEditInstruction] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSummary, setEditSummary] = useState<string | null>(null)
  const [previewingCanonical, setPreviewingCanonical] = useState(false)
  const [approvingArtifact, setApprovingArtifact] = useState(false)
  const [artifactActionError, setArtifactActionError] = useState<string | null>(
    null
  )
  const [previewViewport, setPreviewViewport] = useState<
    'mobile' | 'tablet' | 'desktop'
  >('desktop')

  const loadWebsite = useCallback(async () => {
    setLoadError(null)
    try {
      const response = await fetch(`/api/siteforge/preview/${websiteId}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          responseErrorMessage(response.status, data, 'loading the website preview')
        )
      }
      const preview = data as WebsitePreviewData
      setWebsite(preview)
      setDeploymentDiagnostics(preview.deploymentDiagnostics)
      // Set initial page to first page
      if ((preview.pagesGenerated?.length || 0) > 0 && !selectedPage) {
        setSelectedPage(preview.pagesGenerated?.[0]?.slug || '')
      }
    } catch (error) {
      console.error('Error loading website:', error)
      setWebsite(null)
      setLoadError(
        error instanceof Error ? error.message : 'Failed to load the website preview'
      )
    } finally {
      setLoading(false)
    }
  }, [websiteId, selectedPage])

  useEffect(() => {
    loadWebsite()
  }, [loadWebsite])

  const handleDelete = async () => {
    if (!confirm('Delete this website? This cannot be undone.')) return
    
    setDeleting(true)
    try {
      const response = await fetch(`/api/siteforge/delete/${websiteId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        window.location.href = '/dashboard/siteforge'
      } else {
        alert('Failed to delete website')
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete website')
    }
    setDeleting(false)
  }

  const handleRegenerate = () => {
    const propertyId =
      website?.property && typeof website.property.id === 'string'
        ? website.property.id
        : null

    if (!propertyId) {
      alert('Cannot regenerate: missing property context for this website.')
      return
    }

    if (
      !confirm(
        'Regeneration requires a new reviewed plan. Return to the planning flow for this property?'
      )
    ) {
      return
    }

    setRegenerating(true)
    setDeployError(null)
    window.location.href = regenerationPlanUrl(propertyId, websiteId)
  }

  const handleEdit = () => {
    // Soft focus the edit flow: user selects a section then asks for changes.
    alert('Tip: Click a section below, then describe what you want changed.')
  }

  const handleApplyEdit = async () => {
    if (!selectedSectionId) {
      setEditError('Select a section to edit first.')
      return
    }
    const instruction = editInstruction.trim()
    if (!instruction) {
      setEditError('Type what you want changed.')
      return
    }
    const expectedArtifact = website?.artifact?.history.find(
      (artifact) => artifact.id === website.artifact?.currentId
    )
    if (!expectedArtifact) {
      setEditError('No immutable artifact is available. Reload and try again.')
      return
    }

    setEditing(true)
    setEditError(null)
    setEditSummary(null)

    try {
      const response = await fetch(`/api/siteforge/edit/${websiteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: selectedSectionId,
          userIntent: instruction,
          expectedArtifactId: expectedArtifact.id,
          expectedContentHash: expectedArtifact.content_hash,
        })
      })

      const data = await response.json()
      if (!response.ok) {
        setEditError(data.error || 'Failed to apply edit')
        setEditing(false)
        return
      }

      setEditSummary(data.summary || 'Updated successfully')
      setEditInstruction('')
      await loadWebsite()
    } catch (e) {
      console.error('Edit error:', e)
      setEditError('Failed to apply edit')
    } finally {
      setEditing(false)
    }
  }

  const handleCanonicalPreview = async () => {
    const currentArtifact = website?.artifact?.history.find(
      (artifact) => artifact.id === website.artifact?.currentId
    )
    if (!currentArtifact) {
      setArtifactActionError('No current immutable artifact is available.')
      return
    }
    setPreviewingCanonical(true)
    setArtifactActionError(null)
    try {
      const startResponse = await fetch(
        `/api/siteforge/canonical-preview/${websiteId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artifactId: currentArtifact.id,
            contentHash: currentArtifact.content_hash,
            retry: true,
          }),
        }
      )
      const startResult = await startResponse.json()
      if (!startResponse.ok && startResponse.status !== 202) {
        throw new Error(startResult.error || 'Canonical preview failed')
      }
      if (startResult.status === 'ready') {
        await loadWebsite()
        return
      }
      if (!startResult.jobId) {
        throw new Error('Canonical preview did not return a job identity')
      }
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await fetch(
          `/api/siteforge/canonical-preview/${websiteId}?jobId=${encodeURIComponent(startResult.jobId)}`,
          { cache: 'no-store' }
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Checking canonical preview failed')
        }
        if (result.status === 'succeeded') {
          await loadWebsite()
          return
        }
        if (['failed', 'cancelled'].includes(result.status)) {
          throw new Error(result.error || 'Canonical preview failed')
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000))
      }
      throw new Error('Canonical preview timed out; check the preview job status.')
    } catch (error) {
      setArtifactActionError(
        error instanceof Error ? error.message : 'Canonical preview failed'
      )
    } finally {
      setPreviewingCanonical(false)
    }
  }

  const handleArtifactApproval = async (
    decisionStatus: 'approved' | 'denied'
  ) => {
    const currentArtifact = website?.artifact?.history.find(
      (artifact) => artifact.id === website.artifact?.currentId
    )
    const propertyId =
      website?.property && typeof website.property.id === 'string'
        ? website.property.id
        : null
    if (!currentArtifact || !propertyId) return
    const decisionReason = window.prompt(
      decisionStatus === 'approved'
        ? 'Record why this exact WordPress preview is approved for deployment:'
        : 'Record why deployment is denied:'
    )
    if (!decisionReason?.trim()) return

    setApprovingArtifact(true)
    setArtifactActionError(null)
    try {
      const response = await fetch(
        `/api/siteforge/artifacts/${currentArtifact.id}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId,
            contentHash: currentArtifact.content_hash,
            decisionStatus,
            decisionReason,
          }),
        }
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Artifact decision failed')
      }
      await loadWebsite()
    } catch (error) {
      setArtifactActionError(
        error instanceof Error ? error.message : 'Artifact decision failed'
      )
    } finally {
      setApprovingArtifact(false)
    }
  }

  const handleDeploy = async () => {
    if (
      !confirm(
        'Deploy this exact artifact to linked Cloudways staging? Production promotion remains exclusively in Cloudways.'
      )
    ) return
    
    setDeploying(true)
    setDeployError(null)
    setDeploymentDiagnostics(undefined)
    
    try {
      const response = await fetch(`/api/siteforge/deploy/${websiteId}`, {
        method: 'POST'
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        if (data.requiresConfig) {
          setDeployError('Cloudways staging requires a linked parent application and Cloudways API credentials.')
        } else {
          setDeployError(data.error || 'Deployment failed')
        }
        setDeploying(false)
        return
      }
      
      const startedAt = Date.now()
      while (Date.now() - startedAt < 300_000) {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        const statusResponse = await fetch(siteForgeStatusEndpoint(websiteId), {
          cache: 'no-store',
        })
        const statusPayload = await statusResponse.json().catch(() => ({}))
        if (!statusResponse.ok) {
          throw new Error(
            responseErrorMessage(
              statusResponse.status,
              statusPayload,
              'checking deployment progress'
            )
          )
        }
        const statusData = statusPayload as WebsiteStatusResponse
        if (statusData.deploymentDiagnostics) {
          setDeploymentDiagnostics(statusData.deploymentDiagnostics)
        }

        const outcome = classifyWebsiteStatus(statusData, 'deployment')
        if (outcome.terminal && outcome.succeeded) {
          setDeploying(false)
          await loadWebsite()
          return
        }
        if (outcome.terminal && !outcome.succeeded) {
          setDeploying(false)
          setDeployError(outcome.message)
          return
        }
      }
      setDeployError(
        'Deployment is still not complete after 5 minutes. Check deployment diagnostics and server logs before retrying.'
      )
      setDeploying(false)
    } catch (error) {
      console.error('Deploy error:', error)
      setDeployError(
        error instanceof Error ? error.message : 'Failed to start deployment'
      )
      setDeploying(false)
    }
  }

  const handleOpenRollbackDialog = async () => {
    setRollbackDialogOpen(true)
    setRollbackPreviewLoading(true)
    setRollbackPreview(null)
    setDeployError(null)
    try {
      const response = await fetch(`/api/siteforge/rollback/${websiteId}`)
      const data = await response.json()
      if (!response.ok) {
        setDeployError(data.error || 'Failed to load rollback preview')
        setRollbackDialogOpen(false)
        return
      }
      setRollbackPreview(data as RollbackPreview)
    } catch (error) {
      console.error('Rollback preview error:', error)
      setDeployError('Failed to load rollback preview')
      setRollbackDialogOpen(false)
    } finally {
      setRollbackPreviewLoading(false)
    }
  }

  const handleConfirmRollback = async () => {
    if (
      !rollbackPreview?.canRollback ||
      !rollbackPreview.currentArtifact ||
      !rollbackPreview.rollbackToArtifactId ||
      !rollbackPreview.rollbackToContentHash
    ) {
      return
    }
    const decisionReason = window.prompt(
      'Record why this verified rollback is required:'
    )
    if (!decisionReason || decisionReason.trim().length < 10) return
    setRollingBack(true)
    setDeployError(null)
    try {
      const response = await fetch(`/api/siteforge/rollback/${websiteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedCurrentArtifactId: rollbackPreview.currentArtifact.id,
          targetArtifactId: rollbackPreview.rollbackToArtifactId,
          targetContentHash: rollbackPreview.rollbackToContentHash,
          decisionReason,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        setDeployError(data.error || 'Rollback failed')
        return
      }

      setRollbackDialogOpen(false)
      await loadWebsite()
      alert(data.message || 'Rollback complete.')
    } catch (error) {
      console.error('Rollback error:', error)
      setDeployError('Failed to rollback website')
    } finally {
      setRollingBack(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!website) {
    return (
      <div role="alert" className="py-12 text-center">
        <p className="font-medium text-red-700">Website preview unavailable</p>
        <p className="mt-2 text-sm text-gray-600">
          {loadError || 'Website not found'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => void loadWebsite()}>
          Retry preview
        </Button>
      </div>
    )
  }

  const pages: GeneratedPage[] = website.pagesGenerated || []
  const diagnostics = deploymentDiagnostics
  const remediationTips = getDeploymentRemediationTips(diagnostics)
  const brandReadiness = website.brandReadiness
  const deploymentReadiness = website.deploymentReadiness
  const currentArtifact = website.artifact?.history.find(
    (artifact) => artifact.id === website.artifact?.currentId
  )
  const canonicalPreviewMatches = isExactArtifactPreview({
    currentArtifactId: currentArtifact?.id,
    currentContentHash: currentArtifact?.content_hash,
    previewArtifactId: website.artifact?.canonicalPreviewArtifactId,
    previewContentHash: website.artifact?.canonicalPreviewContentHash,
  })
  const deploymentApproved =
    currentArtifact?.deployment_decision === 'approved' &&
    canonicalPreviewMatches
  const liveArtifactMatches =
    Boolean(currentArtifact) &&
    website.artifact?.deployedArtifactId === currentArtifact?.id &&
    website.artifact?.deployedContentHash === currentArtifact?.content_hash
  const deterministicQualityChecks = getDeterministicQualityChecks(
    currentArtifact?.quality_report
  )
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                {website.property?.name || 'Property Website'}
              </h2>
              <p className="text-base text-gray-600 dark:text-gray-400">
                Generated {website.createdAt ? new Date(website.createdAt).toLocaleDateString() : ''}
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <Badge variant={
                website.generationStatus === 'complete' ? 'success' : 
                website.generationStatus === 'ready_for_preview' ? 'default' :
                website.generationStatus === 'failed' || website.generationStatus === 'deploy_failed' ? 'destructive' :
                'secondary'
              }>
                {website.generationStatus === 'ready_for_preview'
                  ? 'Ready for Artifact Review'
                  : website.generationStatus}
              </Badge>
              {website.brandSource && (
                <Badge variant="outline">
                  Brand: {website.brandSource}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pages</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{pages.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {pages.reduce((sum, p) => sum + (p.sections?.length || 0), 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{website.assets?.length || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {website.brandConfidence ? Math.round(website.brandConfidence * 100) : 'N/A'}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Immutable Artifact & WordPress Preview</CardTitle>
          <CardDescription>
            Deployment is locked to the exact artifact hash rendered in the
            canonical WordPress preview.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentArtifact ? (
            <>
              <div className="grid gap-2 text-sm md:grid-cols-3">
                <p>
                  <span className="font-medium">Version:</span>{' '}
                  {currentArtifact.version}
                </p>
                <p className="truncate" title={currentArtifact.content_hash}>
                  <span className="font-medium">Hash:</span>{' '}
                  {currentArtifact.content_hash.slice(0, 12)}…
                </p>
                <p>
                  <span className="font-medium">Decision:</span>{' '}
                  {currentArtifact.deployment_decision || 'not reviewed'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={handleCanonicalPreview}
                  disabled={previewingCanonical || approvingArtifact}
                >
                  {previewingCanonical
                    ? 'Rendering WordPress Preview…'
                    : canonicalPreviewMatches
                      ? 'Refresh Canonical Preview'
                      : 'Render Canonical Preview'}
                </Button>
                {website.artifact?.canonicalPreviewUrl &&
                canonicalPreviewMatches ? (
                  <Button asChild variant="outline">
                    <a
                      href={website.artifact.canonicalPreviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Exact Preview
                    </a>
                  </Button>
                ) : null}
                <Button
                  onClick={() => handleArtifactApproval('approved')}
                  disabled={
                    !canonicalPreviewMatches ||
                    approvingArtifact ||
                    deploymentApproved
                  }
                >
                  {approvingArtifact
                    ? 'Recording Decision…'
                    : deploymentApproved
                      ? 'Approved for Deployment'
                      : 'Approve Exact Artifact'}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleArtifactApproval('denied')}
                  disabled={!canonicalPreviewMatches || approvingArtifact}
                >
                  Deny
                </Button>
              </div>
              {artifactActionError ? (
                <p role="alert" className="text-sm text-red-600">
                  {artifactActionError}
                </p>
              ) : null}
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Artifact history ({website.artifact?.history.length || 0})
                </summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {website.artifact?.history.map((artifact) => (
                    <li key={artifact.id} className="rounded border p-2">
                      v{artifact.version} · {artifact.change_type} ·{' '}
                      {artifact.content_hash.slice(0, 12)}… ·{' '}
                      {new Date(artifact.created_at).toLocaleString()}
                      {artifact.changes_summary
                        ? ` — ${artifact.changes_summary}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </details>
              <details open>
                <summary className="cursor-pointer text-sm font-medium">
                  Readiness and policy checks (
                  {
                    deterministicQualityChecks.filter((check) => check.passed)
                      .length
                  }
                  /{deterministicQualityChecks.length} passed)
                </summary>
                <ul className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                  {deterministicQualityChecks.map((check) => (
                    <li
                      key={check.id}
                      className={`rounded border p-2 ${
                        check.passed
                          ? 'border-green-200 bg-green-50 text-green-900'
                          : 'border-red-200 bg-red-50 text-red-900'
                      }`}
                    >
                      <span className="font-medium">
                        {check.passed ? 'Passed' : 'Blocked'} · {check.id}
                      </span>
                      <p className="mt-1 text-xs">{check.message}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="text-sm text-amber-700">
              No immutable artifact has been published yet.
            </p>
          )}
        </CardContent>
      </Card>

      {(brandReadiness?.degraded || deploymentReadiness?.ready === false) && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-100">
              Degraded Context Warnings
            </CardTitle>
            <CardDescription className="text-amber-800 dark:text-amber-200">
              Site generation or deploy confidence is reduced; review before publishing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-amber-900 dark:text-amber-100">
            {brandReadiness?.degraded && (
              <div>
                <p className="font-medium">Brand context is weak</p>
                <p className="text-xs mt-1">
                  Source: {brandReadiness.source || 'unknown'} | Confidence:{' '}
                  {brandReadiness.confidence === null
                    ? 'missing'
                    : `${Math.round(brandReadiness.confidence * 100)}%`}
                </p>
                <p className="text-xs mt-1">
                  Blockers: {brandReadiness.blockers.join(', ')}
                </p>
              </div>
            )}
            {deploymentReadiness?.ready === false && (
              <div>
                <p className="font-medium">Deployment provider is not configured</p>
                <p className="text-xs mt-1">
                  Missing: {deploymentReadiness.blockers.join(', ')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canonicalPreviewMatches && website.artifact?.canonicalPreviewUrl ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Exact WordPress Render</CardTitle>
                <CardDescription>
                  The same Gutenberg serializer and theme used for deployment.
                </CardDescription>
              </div>
              <div className="flex gap-2" aria-label="Preview viewport">
                {(['mobile', 'tablet', 'desktop'] as const).map((viewport) => (
                  <Button
                    key={viewport}
                    size="sm"
                    variant={
                      previewViewport === viewport ? 'default' : 'outline'
                    }
                    onClick={() => setPreviewViewport(viewport)}
                  >
                    {viewport[0].toUpperCase() + viewport.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-auto bg-muted p-4">
            <iframe
              title="Canonical WordPress preview"
              src={website.artifact.canonicalPreviewUrl}
              sandbox="allow-scripts allow-same-origin"
              className="mx-auto block min-h-[720px] border bg-white transition-[width]"
              style={{
                width:
                  previewViewport === 'mobile'
                    ? 390
                    : previewViewport === 'tablet'
                      ? 768
                      : '100%',
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Page Preview */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>Site Structure</CardTitle>
              <CardDescription className="mt-1 max-w-3xl">
                Structural breakdown of each page: section order, block type,
                and evidence sources. For visuals, use the Exact WordPress
                Render above — it is the real deployed output.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {canonicalPreviewMatches &&
              website.artifact?.canonicalPreviewUrl ? (
                <Button variant="default" size="sm" asChild>
                  <a
                    href={website.artifact.canonicalPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Exact WordPress Preview →
                  </a>
                </Button>
              ) : null}
              {website.wpUrl ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={website.wpUrl} target="_blank" rel="noopener noreferrer">
                    View Live Site →
                  </a>
                </Button>
              ) : null}
              {website.wpAdminUrl ? (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={website.wpAdminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WP Admin →
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedPage} onValueChange={setSelectedPage}>
            <TabsList>
              {pages.map(page => (
                <TabsTrigger 
                  key={page.slug} 
                  value={page.slug}
                >
                  {page.title}
                </TabsTrigger>
              ))}
            </TabsList>

            {pages.map(page => (
              <TabsContent 
                key={page.slug} 
                value={page.slug}
                className="space-y-4"
              >
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 space-y-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{page.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{page.purpose}</p>
                </div>

                {page.sections && page.sections.length > 0 && (
                  <div className="space-y-6">
                    {page.sections.map((section, idx) => (
                      <div
                        key={section.id || idx}
                        className={`border rounded-lg overflow-hidden transition ${
                          readOnly ? 'cursor-default' : ''
                        } ${
                          selectedSectionId === section.id
                            ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900/30'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        {/* Section Header */}
                        <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="text-xs">
                              #{section.order}
                            </Badge>
                            <span className="font-medium text-sm text-gray-900 dark:text-white">
                              {section.type}
                            </span>
                            <span className="text-xs text-gray-500">
                              ({section.acfBlock})
                            </span>
                            <span
                              className="text-xs text-gray-500"
                              title={section.evidenceIds?.join(', ') || undefined}
                            >
                              {section.evidenceIds?.length || 0} evidence source
                              {(section.evidenceIds?.length || 0) === 1
                                ? ''
                                : 's'}
                            </span>
                          </div>
                          {!readOnly ? (
                            <button
                              type="button"
                              className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-gray-300 dark:hover:bg-gray-700"
                              aria-pressed={selectedSectionId === section.id}
                              onClick={() => {
                                if (section.id) setSelectedSectionId(section.id)
                                setEditError(null)
                                setEditSummary(null)
                              }}
                            >
                              {selectedSectionId === section.id
                                ? 'Selected for editing'
                                : 'Select for editing'}
                            </button>
                          ) : null}
                        </div>

                        {/* Inline Edit UI */}
                        {!readOnly && selectedSectionId === section.id && (
                          <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-4 space-y-3">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              Ask AI to change this section
                            </div>
                            <textarea
                              aria-label={`Edit instruction for ${section.label || section.type}`}
                              value={editInstruction}
                              onChange={(e) => setEditInstruction(e.target.value)}
                              placeholder="Example: Make this feel more luxury, shorten the headline, and emphasize the pool + fitness center."
                              className="w-full min-h-[90px] rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                              disabled={editing}
                            />
                            <div className="flex items-center gap-3">
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleApplyEdit()
                                }}
                                disabled={editing}
                              >
                                {editing ? 'Applying…' : 'Apply AI Edit'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setSelectedSectionId(null)
                                  setEditInstruction('')
                                  setEditError(null)
                                  setEditSummary(null)
                                }}
                                disabled={editing}
                              >
                                Cancel
                              </Button>
                              {editSummary && (
                                <span className="text-xs text-green-700 dark:text-green-300">{editSummary}</span>
                              )}
                              {editError && (
                                <span className="text-xs text-red-700 dark:text-red-300">{editError}</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Design Decisions */}
      {website.siteArchitecture?.designDecisions && (
        <Card>
          <CardHeader>
            <CardTitle>Design Strategy</CardTitle>
            <CardDescription>AI-driven design decisions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <h4 className="text-sm font-medium mb-1 text-gray-900 dark:text-white">Color Strategy</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {website.siteArchitecture.designDecisions.colorStrategy}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1 text-gray-900 dark:text-white">Image Strategy</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {website.siteArchitecture.designDecisions.imageStrategy}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1 text-gray-900 dark:text-white">Content Density</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {website.siteArchitecture.designDecisions.contentDensity}
              </p>
            </div>
            {(website.siteArchitecture.designDecisions.conversionOptimization?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-1 text-gray-900 dark:text-white">Conversion Optimizations</h4>
                <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  {(website.siteArchitecture.designDecisions.conversionOptimization ?? []).map((item: string, idx: number) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deploy Error */}
      {deployError && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <CardContent className="py-4">
            <p className="text-sm text-red-700 dark:text-red-300">{deployError}</p>
          </CardContent>
        </Card>
      )}

      {/* Deployment Diagnostics */}
      {diagnostics && (
        <Card className={diagnostics.status === 'failed'
          ? 'border-red-200 dark:border-red-800'
          : 'border-green-200 dark:border-green-800'
        }>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Deployment Diagnostics</CardTitle>
                <CardDescription>
                  Last WordPress deployment verification snapshot
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={diagnostics.status === 'failed' ? 'destructive' : 'success'}>
                  {diagnostics.status === 'failed' ? 'Failed' : 'Successful'}
                </Badge>
                <Badge variant={diagnostics.verification.status === 'failed' ? 'destructive' : 'outline'}>
                  Verification: {diagnostics.verification.status}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-gray-500 dark:text-gray-400">Provider</p>
                <p className="font-medium">{diagnostics.provider}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Pages Verified</p>
                <p className="font-medium">{diagnostics.pagesAttempted}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Assets Verified</p>
                <p className="font-medium">{diagnostics.assetsAttempted}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Completed</p>
                <p className="font-medium">
                  {new Date(diagnostics.completedAt).toLocaleString()}
                </p>
              </div>
            </div>

            {diagnostics.error && (
              <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-red-700 dark:text-red-300">
                  {diagnostics.error.category}
                </p>
                <p className="text-sm text-red-700 dark:text-red-300">
                  {diagnostics.error.message}
                </p>
              </div>
            )}

            {remediationTips.length > 0 && (
              <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
                  Retry Guidance
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                  {remediationTips.map((tip, idx) => (
                    <li key={`${idx}-${tip}`}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {!readOnly ? <div className="flex justify-between">
        <Button 
          variant="destructive" 
          onClick={handleDelete}
          disabled={deleting || deploying || regenerating || rollingBack}
        >
          {deleting ? 'Deleting...' : 'Delete Website'}
        </Button>
        <div className="flex space-x-3">
          <Button variant="outline" onClick={handleRegenerate} disabled={deploying || regenerating || rollingBack}>
            {regenerating ? 'Regenerating...' : 'Regenerate Site'}
          </Button>
          {!readOnly ? (
            <Button variant="outline" onClick={handleEdit} disabled={deploying || regenerating || rollingBack}>
              Edit Content
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={handleOpenRollbackDialog}
            disabled={deploying || regenerating || rollingBack}
          >
            {rollingBack ? 'Rolling Back...' : 'Rollback Version'}
          </Button>
          
          {/* Show different button based on status */}
          {website.wpUrl && liveArtifactMatches ? (
            <Button asChild>
              <a href={website.wpUrl} target="_blank" rel="noopener noreferrer">
                View Live Site →
              </a>
            </Button>
          ) : website.generationStatus === 'deploying' || deploying || regenerating || rollingBack ? (
            <Button disabled>
              <span className="animate-spin mr-2">⏳</span>
              {regenerating
                ? 'Regenerating...'
                : rollingBack
                  ? 'Rolling Back...'
                  : 'Deploying...'}
            </Button>
          ) : (
            <Button onClick={handleDeploy} disabled={!deploymentApproved}>
              {deploymentApproved
                ? 'Deploy to Cloudways Staging'
                : 'Approve Exact Preview for Staging'}
            </Button>
          )}
        </div>
      </div> : null}

      <Dialog open={rollbackDialogOpen} onOpenChange={setRollbackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rollback</DialogTitle>
            <DialogDescription>
              Restore this website from the previous saved version before redeploying.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300 space-y-3">
            {rollbackPreviewLoading ? (
              <p>Loading rollback target...</p>
            ) : rollbackPreview?.canRollback ? (
              <>
                <p>
                  You are about to roll back from version{' '}
                  <strong>{rollbackPreview.currentArtifact?.version}</strong> to
                  verified version{' '}
                  <strong>{rollbackPreview.rollbackToVersion}</strong>.
                </p>
                {rollbackPreview.rollbackToArtifactId && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Source immutable artifact:{' '}
                    {rollbackPreview.rollbackToArtifactId}
                  </p>
                )}
              </>
            ) : (
              <p>{rollbackPreview?.message || 'No previous version is available for rollback.'}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRollbackDialogOpen(false)}
              disabled={rollingBack}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmRollback}
              disabled={rollbackPreviewLoading || rollingBack || !rollbackPreview?.canRollback}
            >
              {rollingBack ? 'Rolling Back...' : 'Confirm Rollback'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}







