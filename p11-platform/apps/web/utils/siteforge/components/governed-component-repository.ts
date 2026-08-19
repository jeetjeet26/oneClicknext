import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  compileGovernedComponent,
  governedComponentPackageSchema,
  governedComponentSchema,
  registerGovernedComponentPackage,
} from './governed-component'
import type { z } from 'zod'

type ServiceClient = SupabaseClient<Database>
type GovernedComponentInput = z.input<typeof governedComponentSchema>

export type SignedGovernedComponentPackage = z.infer<
  typeof governedComponentPackageSchema
> & {
  signature: string
  signatureAlgorithm: 'hmac-sha256'
  signingKeyId: string
}

export function buildSignedGovernedComponentPackage(input: {
  descriptor: GovernedComponentInput
  compilerVersion?: string
  signingSecret: string
  signingKeyId: string
}): {
  compiled: ReturnType<typeof compileGovernedComponent>
  package: SignedGovernedComponentPackage
} {
  if (input.signingSecret.length < 32) {
    throw new Error(
      'SITEFORGE_COMPONENT_SIGNING_SECRET must contain at least 32 characters'
    )
  }
  if (!input.signingKeyId.trim()) {
    throw new Error('A governed component signing key ID is required')
  }
  const compiled = compileGovernedComponent(
    input.descriptor,
    input.compilerVersion
  )
  const unsigned = {
    format: 'siteforge-governed-component-package-v1' as const,
    componentId: compiled.componentId,
    componentVersion: compiled.componentVersion,
    compilerVersion: compiled.compilerVersion,
    descriptorSha256: compiled.descriptorHash,
    files: [
      {
        path: 'component.json' as const,
        mediaType: 'application/json' as const,
        byteSha256: compiled.descriptorHash,
      },
    ],
  }
  const packageSha256 = hashSiteForgeContent(unsigned)
  const parsedPackage = governedComponentPackageSchema.parse({
    ...unsigned,
    packageSha256,
  })
  registerGovernedComponentPackage({
    compiled,
    package: parsedPackage,
  })
  const signature = createHmac('sha256', input.signingSecret)
    .update(hashSiteForgeContent(parsedPackage))
    .digest('hex')
  return {
    compiled,
    package: {
      ...parsedPackage,
      signature,
      signatureAlgorithm: 'hmac-sha256',
      signingKeyId: input.signingKeyId.trim(),
    },
  }
}

export async function publishGovernedComponent(
  input: {
    descriptor: GovernedComponentInput
    displayName?: string
    compilerVersion?: string
    signingSecret?: string
    signingKeyId?: string
  },
  client: ServiceClient = createServiceClient()
) {
  const signed = buildSignedGovernedComponentPackage({
    descriptor: input.descriptor,
    compilerVersion: input.compilerVersion,
    signingSecret:
      input.signingSecret ||
      process.env.SITEFORGE_COMPONENT_SIGNING_SECRET ||
      '',
    signingKeyId:
      input.signingKeyId ||
      process.env.SITEFORGE_COMPONENT_SIGNING_KEY_ID ||
      '',
  })
  const descriptor = governedComponentSchema.parse(input.descriptor)
  const registryLookup = await client
    .from('siteforge_component_registry')
    .select('*')
    .eq('component_key', signed.compiled.componentId)
    .maybeSingle()
  let registry = registryLookup.data
  const registryError = registryLookup.error
  if (registryError) {
    throw new Error(
      `Failed to reconcile governed component registry: ${registryError.message}`
    )
  }
  if (!registry) {
    const created = await client
      .from('siteforge_component_registry')
      .insert({
        component_key: signed.compiled.componentId,
        display_name: input.displayName || descriptor.displayName,
        lifecycle_status: 'active',
      })
      .select('*')
      .single()
    if (created.error || !created.data) {
      throw new Error(
        `Failed to create governed component registry entry: ${
          created.error?.message || 'missing row'
        }`
      )
    }
    registry = created.data
  }

  const existing = await client
    .from('siteforge_component_versions')
    .select('*')
    .eq('component_id', registry.id)
    .eq('semantic_version', signed.compiled.componentVersion)
    .maybeSingle()
  if (existing.error) {
    throw new Error(
      `Failed to inspect governed component version: ${existing.error.message}`
    )
  }
  if (existing.data) {
    if (
      existing.data.descriptor_sha256 !== signed.compiled.descriptorHash ||
      existing.data.package_sha256 !== signed.package.packageSha256 ||
      existing.data.signature !== signed.package.signature
    ) {
      throw new Error(
        'Governed component version already exists with a different immutable identity'
      )
    }
    return { registry, version: existing.data, compiled: signed.compiled }
  }

  const createdVersion = await client
    .from('siteforge_component_versions')
    .insert({
      component_id: registry.id,
      semantic_version: signed.compiled.componentVersion,
      schema_version: 1,
      compiler_version: signed.compiled.compilerVersion,
      descriptor: descriptor as unknown as Json,
      descriptor_sha256: signed.compiled.descriptorHash,
      package_manifest: signed.package as unknown as Json,
      package_sha256: signed.package.packageSha256,
      v2_catalog_entry: signed.compiled.catalogs.v2 as unknown as Json,
      v3_catalog_entry: {
        ...signed.compiled.catalogs.v3,
        packageSha256: signed.package.packageSha256,
      } as unknown as Json,
      accessibility_contract:
        signed.compiled.accessibilityContract as unknown as Json,
      certification_scenarios:
        signed.compiled.certificationScenarios as unknown as Json,
      signature: signed.package.signature,
      signature_algorithm: signed.package.signatureAlgorithm,
      signing_key_id: signed.package.signingKeyId,
    })
    .select('*')
    .single()
  if (createdVersion.error || !createdVersion.data) {
    throw new Error(
      `Failed to publish governed component version: ${
        createdVersion.error?.message || 'missing row'
      }`
    )
  }
  const updatedRegistry = await client
    .from('siteforge_component_registry')
    .update({
      current_version_id: createdVersion.data.id,
      display_name: input.displayName || descriptor.displayName,
      lifecycle_status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', registry.id)
    .select('*')
    .single()
  if (updatedRegistry.error || !updatedRegistry.data) {
    throw new Error(
      `Failed to activate governed component version: ${
        updatedRegistry.error?.message || 'missing row'
      }`
    )
  }
  return {
    registry: updatedRegistry.data,
    version: createdVersion.data,
    compiled: signed.compiled,
  }
}

