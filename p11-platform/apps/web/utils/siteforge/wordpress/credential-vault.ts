import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'

const storedWordPressCredentialSchema = z.object({
  provider: z.enum(['cloudways', 'wordpress']),
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  ssh: z
    .object({
      host: z.string().min(1),
      port: z.number().int().positive(),
      username: z.string().min(1),
      password: z.string().min(1),
      applicationRoot: z.string().min(1).optional(),
    })
    .optional(),
  providerMetadata: z
    .object({
      provider: z.literal('cloudways'),
      serverId: z.string().min(1),
      applicationId: z.string().min(1),
      publicIp: z.string().min(1),
    })
    .optional(),
})

export type StoredWordPressCredential = z.infer<
  typeof storedWordPressCredentialSchema
>

export async function storeWordPressCredentialReference(input: {
  websiteId: string
  credentials: StoredWordPressCredential
  secretName?: string
  description?: string
  linkWebsite?: boolean
}): Promise<string> {
  const supabase = createServiceClient()
  const credentials = storedWordPressCredentialSchema.parse(input.credentials)
  const { data: secretId, error } = await supabase.rpc(
    'store_siteforge_credential_secret',
    {
      p_secret: JSON.stringify(credentials),
      p_name: input.secretName || input.websiteId,
      p_description:
        input.description || 'SiteForge WordPress deployment credential',
    }
  )
  if (error || !secretId) {
    throw new Error(`Failed to store WordPress credential reference: ${error?.message}`)
  }
  const reference = `supabase-vault:${secretId}`
  if (input.linkWebsite !== false) {
    const { error: updateError } = await supabase
      .from('property_websites')
      .update({ wordpress_credential_ref: reference })
      .eq('id', input.websiteId)
    if (updateError) {
      throw new Error(`Failed to link WordPress credential reference: ${updateError.message}`)
    }
  }
  return reference
}

export async function getWordPressCredentialReference(
  reference: string
): Promise<StoredWordPressCredential> {
  const match = /^supabase-vault:([0-9a-f-]{36})$/i.exec(reference)
  if (!match) {
    throw new Error('Unsupported WordPress credential reference')
  }
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('get_siteforge_credential_secret', {
    p_secret_id: match[1],
  })
  if (error || !data) {
    throw new Error(`Failed to resolve WordPress credential reference: ${error?.message}`)
  }
  return storedWordPressCredentialSchema.parse(JSON.parse(data))
}
