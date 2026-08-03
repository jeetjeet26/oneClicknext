// SiteForge: Website Preview Page
// /dashboard/siteforge/[websiteId]
// Created: December 11, 2025

import {
  SiteForgeEditorWorkspace,
  WebsitePreview,
} from '@/components/siteforge'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
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
  const semanticEditorEnabled =
    process.env.SITEFORGE_SEMANTIC_EDITOR_ENABLED === 'true'

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

      {semanticEditorEnabled ? (
        <SiteForgeEditorWorkspace websiteId={websiteId} />
      ) : (
        <WebsitePreview websiteId={websiteId} />
      )}
    </div>
  )
}


















