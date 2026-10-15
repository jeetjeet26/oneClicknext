import type { Document } from '@/utils/intelligence/contracts'

export type WebsiteDirection = {
  id: string; name: string; direction: unknown; content_hash: string; website_id: string;
}

// Resolve once before packaging. Only the selected content reaches the builder.
export function selectPackageDirection(website: WebsiteDirection | null, brief: Document | null) {
  if (website) return {
    source: 'website' as const, id: website.id, name: website.name,
    websiteId: website.website_id, revision: null, hash: website.content_hash,
    content: website.direction,
  }
  if (brief?.kind === 'creative' && brief.status === 'approved') return {
    source: 'property_brief' as const, id: brief.id,
    name: String((brief.payload as { title?: string }).title ?? 'Approved property design brief'),
    websiteId: null, revision: brief.revision, hash: null, content: brief.payload,
  }
  return null
}
