// SiteForge: Website Preview Page
// /dashboard/siteforge/[websiteId]
// Created: December 11, 2025

import { SiteForgeGuidedWorkspace } from '@/components/siteforge/SiteForgeGuidedWorkspace'
import { createServiceClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { loadSiteForgeDirectorSnapshot } from '@/utils/siteforge/director/snapshot'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

export default async function SiteForgePreviewPage({
  params,
}: {
  params: Promise<{ websiteId: string }>
}) {
  const supabase = await createClient()
  const { websiteId } = await params
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
    .select('property_id')
    .eq('id', websiteId)
    .maybeSingle()

  if (websiteError || !website) {
    notFound()
  }

  const access = await validatePropertyAccess(user.id, website.property_id)
  if (!access.authorized) {
    notFound()
  }

  const initialSnapshot = await loadSiteForgeDirectorSnapshot(
    websiteId,
    service
  ).catch(() => null)

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          href="/dashboard/siteforge"
          className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center space-x-1 font-medium"
        >
          <span>←</span>
          <span>Back to SiteForge</span>
        </Link>
      </div>

      <SiteForgeGuidedWorkspace
        websiteId={websiteId}
        propertyId={website.property_id}
        initialSnapshot={initialSnapshot}
      />
    </div>
  )
}


