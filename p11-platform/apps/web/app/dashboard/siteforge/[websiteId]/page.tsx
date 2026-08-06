// SiteForge: Website Preview Page
// /dashboard/siteforge/[websiteId]
// Created: December 11, 2025

import {
  SiteForgeEditorWorkspace,
  WebsitePreview,
} from '@/components/siteforge'
import { createClient } from '@/utils/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

export default async function SiteForgePreviewPage({
  params
}: {
  params: Promise<{ websiteId: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { websiteId } = await params
  const { data: website, error: websiteError } = await supabase
    .from('property_websites')
    .select('current_artifact_version_id')
    .eq('id', websiteId)
    .maybeSingle()

  if (websiteError || !website) {
    notFound()
  }

  const isLegacyArtifact = !website.current_artifact_version_id

  return (
    <div className="container max-w-7xl py-8">
      <div className="mb-6">
        <Link
          href="/dashboard/siteforge"
          className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center space-x-1 font-medium"
        >
          <span>←</span>
          <span>Back to SiteForge</span>
        </Link>
      </div>

      {isLegacyArtifact ? (
        <div className="space-y-4">
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            role="status"
          >
            This legacy website is read-only. Regenerate it to create a current
            artifact before editing.
          </div>
          <WebsitePreview websiteId={websiteId} readOnly />
        </div>
      ) : (
        <SiteForgeEditorWorkspace websiteId={websiteId} />
      )}
    </div>
  )
}


















