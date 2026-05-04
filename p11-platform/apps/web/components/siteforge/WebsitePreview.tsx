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
import { ACFBlockRenderer, type DesignSystem } from './ACFBlockRenderer'
import type { GeneratedPage, WebsiteStatusResponse } from '@/types/siteforge'

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
  pagesGenerated?: GeneratedPage[]
  assets?: unknown[]
  deploymentDiagnostics?: WebsiteStatusResponse['deploymentDiagnostics']
  wpUrl?: string
  wpAdminUrl?: string
  createdAt?: string
  completedAt?: string
}

interface WebsitePreviewProps {
  websiteId: string
}

type RollbackPreview = {
  canRollback: boolean
  currentVersion: number
  rollbackToVersion?: number
  rollbackToWebsiteId?: string
  message?: string
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

export function WebsitePreview({ websiteId }: WebsitePreviewProps) {
  const [website, setWebsite] = useState<WebsitePreviewData | null>(null)
  const [selectedPage, setSelectedPage] = useState<string>('')
  const [loading, setLoading] = useState(true)
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

  const loadWebsite = useCallback(async () => {
    try {
      const response = await fetch(`/api/siteforge/preview/${websiteId}`)
      const data = (await response.json()) as WebsitePreviewData
      setWebsite(data)
      setDeploymentDiagnostics(data.deploymentDiagnostics)
      // Set initial page to first page
      if ((data.pagesGenerated?.length || 0) > 0 && !selectedPage) {
        setSelectedPage(data.pagesGenerated?.[0]?.slug || '')
      }
      setLoading(false)
    } catch (error) {
      console.error('Error loading website:', error)
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

    if (!confirm('Generate a fresh website version for this property?')) {
      return
    }

    setRegenerating(true)
    setDeployError(null)

    void (async () => {
      try {
        const response = await fetch('/api/siteforge/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            propertyId,
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          alert(data.error || 'Failed to start regeneration')
          return
        }

        if (typeof data.websiteId !== 'string' || data.websiteId.length === 0) {
          alert('Regeneration started but no website id was returned.')
          return
        }

        window.location.href = `/dashboard/siteforge/${data.websiteId}`
      } catch (error) {
        console.error('Regenerate error:', error)
        alert('Failed to start regeneration')
      } finally {
        setRegenerating(false)
      }
    })()
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

    setEditing(true)
    setEditError(null)
    setEditSummary(null)

    try {
      const response = await fetch(`/api/siteforge/edit/${websiteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: selectedSectionId,
          userIntent: instruction
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

  const handleDeploy = async () => {
    if (!confirm('Deploy this website to WordPress? This will create a live site.')) return
    
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
          setDeployError('WordPress deployment requires Cloudways API credentials. Please contact your administrator to configure CLOUDWAYS_API_KEY and CLOUDWAYS_EMAIL.')
        } else {
          setDeployError(data.error || 'Deployment failed')
        }
        setDeploying(false)
        return
      }
      
      // Start polling for deployment status
      let finished = false
      const pollDeployment = setInterval(async () => {
        const statusResponse = await fetch(`/api/siteforge/status/${websiteId}`)
        const statusData = (await statusResponse.json()) as WebsiteStatusResponse
        if (statusData.deploymentDiagnostics) {
          setDeploymentDiagnostics(statusData.deploymentDiagnostics)
        }
        
        if (statusData.status === 'complete') {
          finished = true
          clearInterval(pollDeployment)
          clearTimeout(deploymentTimeout)
          setDeploying(false)
          loadWebsite() // Refresh to show WP URL
        } else if (statusData.status === 'deploy_failed') {
          finished = true
          clearInterval(pollDeployment)
          clearTimeout(deploymentTimeout)
          setDeploying(false)
          setDeployError(
            statusData.deploymentDiagnostics?.error?.message ||
              statusData.errorMessage ||
              'Deployment failed'
          )
        }
      }, 2000)
      
      // Timeout after 5 minutes
      const deploymentTimeout = setTimeout(() => {
        if (finished) {
          return
        }
        clearInterval(pollDeployment)
        setDeploying(false)
        setDeployError('Deployment timed out. Please check the status and try again.')
      }, 300000)
      
    } catch (error) {
      console.error('Deploy error:', error)
      setDeployError('Failed to start deployment')
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
    if (!rollbackPreview?.canRollback) {
      return
    }
    setRollingBack(true)
    setDeployError(null)
    try {
      const response = await fetch(`/api/siteforge/rollback/${websiteId}`, {
        method: 'POST',
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
      <div className="text-center py-12">
        <p className="text-gray-500">Website not found</p>
      </div>
    )
  }

  const pages: GeneratedPage[] = website.pagesGenerated || []
  const diagnostics = deploymentDiagnostics
  const remediationTips = getDeploymentRemediationTips(diagnostics)
  const brandReadiness = website.brandReadiness
  const deploymentReadiness = website.deploymentReadiness
  
  // Get design system from website data (can be at top level or in siteArchitecture)
  const designSystem: DesignSystem | undefined = 
    website.designSystem || 
    website.siteArchitecture?.designSystem || 
    undefined

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
                {website.generationStatus === 'ready_for_preview' ? 'Ready to Deploy' : website.generationStatus}
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

      {/* Page Preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Site Preview</CardTitle>
            {website.wpUrl && (
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={website.wpUrl} target="_blank" rel="noopener noreferrer">
                    View Live Site →
                  </a>
                </Button>
                {website.wpAdminUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={website.wpAdminUrl} target="_blank" rel="noopener noreferrer">
                      WP Admin →
                    </a>
                  </Button>
                )}
              </div>
            )}
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
                        className={`border rounded-lg overflow-hidden cursor-pointer transition ${
                          selectedSectionId === section.id
                            ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900/30'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                        onClick={() => {
                          if (section.id) setSelectedSectionId(section.id)
                          setEditError(null)
                          setEditSummary(null)
                        }}
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
                          </div>
                          <div className="text-xs text-gray-500">
                            {selectedSectionId === section.id ? 'Selected' : 'Click to edit'}
                          </div>
                        </div>

                        {/* Inline Edit UI */}
                        {selectedSectionId === section.id && (
                          <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-4 space-y-3">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              Ask AI to change this section
                            </div>
                            <textarea
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
                        
                        {/* Visual Preview */}
                        <div className="bg-white dark:bg-gray-900">
                          <ACFBlockRenderer
                            blockType={section.acfBlock || section.type}
                            content={section.content}
                            designSystem={designSystem}
                          />
                        </div>
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
      <div className="flex justify-between">
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
          <Button variant="outline" onClick={handleEdit} disabled={deploying || regenerating || rollingBack}>
            Edit Content
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenRollbackDialog}
            disabled={deploying || regenerating || rollingBack}
          >
            {rollingBack ? 'Rolling Back...' : 'Rollback Version'}
          </Button>
          
          {/* Show different button based on status */}
          {website.wpUrl ? (
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
            <Button onClick={handleDeploy}>
              Deploy to WordPress
            </Button>
          )}
        </div>
      </div>

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
                  <strong>{rollbackPreview.currentVersion}</strong> to version{' '}
                  <strong>{rollbackPreview.rollbackToVersion}</strong>.
                </p>
                {rollbackPreview.rollbackToWebsiteId && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Source website snapshot: {rollbackPreview.rollbackToWebsiteId}
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







