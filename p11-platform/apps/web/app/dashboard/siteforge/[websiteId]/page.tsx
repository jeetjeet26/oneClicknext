// SiteForge: Website Preview Page
// /dashboard/siteforge/[websiteId]
// Created: December 11, 2025

import {
  WebsitePreview,
} from '@/components/siteforge'
import { SiteForgeDirector } from '@/components/siteforge/SiteForgeDirector'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { loadSiteForgeDirectorSnapshot } from '@/utils/siteforge/director/snapshot'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

export default async function SiteForgePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ websiteId: string }>
  searchParams: Promise<{ workspace?: string }>
}) {
  const supabase = await createClient()
  const { websiteId } = await params
  const { workspace } = await searchParams
  const authResult = await supabase.auth.getUser()
  const {
    data: { user },
  } = authResult

  if (!user) {
    redirect('/auth/login')
  }

  const service = createServiceClient()
  const { data: website, error: websiteError } = await service
    .from('property_websites')
    .select('property_id, current_artifact_version_id')
    .eq('id', websiteId)
    .maybeSingle()

  if (websiteError || !website) {
    notFound()
  }

  const access = await validatePropertyAccess(user.id, website.property_id)
  if (!access.authorized) {
    notFound()
  }

  const isLegacyArtifact = !website.current_artifact_version_id
  const initialSnapshot = await loadSiteForgeDirectorSnapshot(
    websiteId,
    service
  ).catch(() => null)

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

      <SiteForgeDirector
        websiteId={websiteId}
        initialSnapshot={initialSnapshot}
        initialArea={workspace}
      />

      {isLegacyArtifact ? (
        <div className="mt-8 space-y-4 border-t border-gray-200 pt-8 dark:border-gray-700">
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            role="status"
          >
            This legacy website is read-only. Regenerate it to create a current
            artifact before editing.
          </div>
          <WebsitePreview websiteId={websiteId} readOnly />
        </div>
      ) : null}
    </div>
  )
}


















