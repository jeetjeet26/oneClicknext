import { NextRequest } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { buildBrandBookPdf } from '@/utils/brandforge/pdf'
import { normalizeBrandAssetRow } from '@/utils/brandforge/normalize'

async function ensureBrandAssetsBucket(supabaseAdmin: ReturnType<typeof createAdminClient>) {
  const { error } = await supabaseAdmin.storage.createBucket('brand-assets', {
    public: true,
    fileSizeLimit: '20MB',
  })

  // Bucket may already exist (ignore this case).
  const message = error?.message?.toLowerCase() || ''
  if (error && !message.includes('already exists')) {
    throw error
  }
}

/**
 * Generate final brand book PDF artifact.
 */
import { runBrandCommand } from '@/utils/brandforge/operations'

export async function POST(request: NextRequest) {
 return runBrandCommand(request, 'export', {}, async ({ body, brand, client: supabaseAdmin }) => {
    const contract = normalizeBrandAssetRow(
      brand as unknown as Record<string, unknown>,
    )
    const primaryLogo = contract.logos.variants.find(logo => logo.role === 'primary')

    const brandBook = {
      metadata: {
        brandName: contract.identity.name,
        generatedAt: new Date().toISOString(),
        revision: brand.revision
      },
      sections: {
        cover: {
          brandName: contract.identity.name,
          tagline: contract.identity.tagline,
          logo: primaryLogo?.url,
        },
        introduction: contract.introduction,
        positioning: contract.positioning,
        targetAudience: contract.audience,
        personas: contract.personas,
        nameStory: contract.identity,
        logo: contract.logos,
        typography: contract.typography,
        colors: contract.colors,
        designElements: contract.designElements,
        photoGuidelines: {
          yep: contract.photographyYes,
          nope: contract.photographyNo,
        },
        implementation: contract.implementation,
      }
    }

    const pdfBytes = buildBrandBookPdf(brandBook)
    const fileName = `${brand.property_id}/brand-book-${brand.id}-r${brand.revision}-${body.requestId}.pdf`
    let { error: uploadError } = await supabaseAdmin.storage
      .from('brand-assets')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false
      })

    if (uploadError && uploadError.message.toLowerCase().includes('bucket not found')) {
      await ensureBrandAssetsBucket(supabaseAdmin)
      ;({ error: uploadError } = await supabaseAdmin.storage
        .from('brand-assets')
        .upload(fileName, pdfBytes, {
          contentType: 'application/pdf',
          upsert: false
        }))
    }

    if (uploadError) throw new Error('Brand export upload failed')

    const { data: urlData } = supabaseAdmin.storage
      .from('brand-assets')
      .getPublicUrl(fileName)

    return { updates: { brand_book_pdf_url: urlData.publicUrl, pdf_generated_at: new Date().toISOString() }, result: { pdfUrl: urlData.publicUrl, exportFormat: 'pdf', embeddedToKnowledgeBase: false, exportedRevision: brand.revision } }
 })
}
