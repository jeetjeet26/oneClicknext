/**
 * Unified Asset Storage Service
 * 
 * Centralizes all asset storage operations across the P11 ecosystem.
 * All products (ForgeStudio, BrandForge, SiteForge, etc.) should use this
 * service to store and retrieve assets.
 * 
 * Assets are stored in Supabase Storage buckets and referenced by public URLs
 * in the database - NOT as base64 data URLs.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import { v4 as uuidv4 } from 'uuid'
import type { Json } from '@/types/supabase'

// Storage bucket names
export const STORAGE_BUCKETS = {
  BRAND_ASSETS: 'brand-assets',      // Logos, moodboards, brand books
  CONTENT_ASSETS: 'content-assets',  // ForgeStudio generated images/videos
  PROPERTY_ASSETS: 'property-assets', // Property photos, floor plans
  DOCUMENTS: 'documents',             // Uploaded PDFs, contracts, etc.
} as const

export type StorageBucket = typeof STORAGE_BUCKETS[keyof typeof STORAGE_BUCKETS]

// Asset types
export type AssetType = 'image' | 'video' | 'document' | 'audio'

// Upload options
export interface UploadOptions {
  bucket: StorageBucket
  propertyId: string
  folder?: string           // Optional subfolder within property folder
  filename?: string         // Optional custom filename (auto-generated if not provided)
  contentType?: string      // MIME type
  upsert?: boolean          // Overwrite if exists
  isPublic?: boolean        // Whether to return public URL (default: true)
}

// Upload result
export interface UploadResult {
  success: boolean
  publicUrl?: string
  storagePath?: string
  error?: string
  fileSize?: number
}

// Asset metadata for database storage
export interface AssetMetadata {
  propertyId: string
  name: string
  description?: string
  assetType: AssetType
  fileUrl: string
  storagePath: string
  thumbnailUrl?: string
  fileSizeBytes?: number
  width?: number
  height?: number
  durationSeconds?: number
  format?: string
  isAiGenerated?: boolean
  generationProvider?: string
  generationPrompt?: string
  generationParams?: Record<string, unknown>
  tags?: string[]
  folder?: string
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/json': 'json',
  }
  return mimeToExt[mimeType] || 'bin'
}

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const extToMime: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'json': 'application/json',
  }
  return extToMime[ext] || 'application/octet-stream'
}

/**
 * Determine asset type from MIME type
 */
function getAssetTypeFromMime(mimeType: string): AssetType {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'document'
}

/**
 * Generate a unique filename
 */
function generateFilename(prefix: string, extension: string): string {
  const timestamp = Date.now()
  const uuid = uuidv4().slice(0, 8)
  return `${prefix}-${timestamp}-${uuid}.${extension}`
}

/**
 * Build the full storage path
 */
function buildStoragePath(options: UploadOptions, filename: string): string {
  const parts = [options.propertyId]
  if (options.folder) {
    parts.push(options.folder)
  }
  parts.push(filename)
  return parts.join('/')
}

/**
 * Upload a base64-encoded asset to Supabase Storage
 * 
 * @param base64Data - The base64-encoded file data (without data URL prefix)
 * @param options - Upload options including bucket, propertyId, etc.
 * @returns Upload result with public URL
 */
export async function uploadBase64Asset(
  base64Data: string,
  mimeType: string,
  options: UploadOptions
): Promise<UploadResult> {
  const supabase = createServiceClient()

  try {
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64')
    
    // Generate filename if not provided
    const extension = getExtensionFromMimeType(mimeType)
    const filename = options.filename || generateFilename('asset', extension)
    
    // Build full storage path
    const storagePath = buildStoragePath(options, filename)
    
    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(options.bucket)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: options.upsert ?? true,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return {
        success: false,
        error: uploadError.message,
      }
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(options.bucket)
      .getPublicUrl(storagePath)

    return {
      success: true,
      publicUrl: urlData.publicUrl,
      storagePath,
      fileSize: buffer.length,
    }
  } catch (error) {
    console.error('Asset upload error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }
  }
}

/**
 * Upload a File object to Supabase Storage
 * 
 * @param file - The File object to upload
 * @param options - Upload options
 * @returns Upload result with public URL
 */
export async function uploadFileAsset(
  file: File | Blob,
  options: UploadOptions
): Promise<UploadResult> {
  const supabase = createServiceClient()

  try {
    // Get content type
    const mimeType = options.contentType || file.type || 'application/octet-stream'
    
    // Generate filename if not provided
    const extension = getExtensionFromMimeType(mimeType)
    const originalName = file instanceof File ? file.name.replace(/\.[^/.]+$/, '') : 'file'
    const filename = options.filename || generateFilename(originalName, extension)
    
    // Build full storage path
    const storagePath = buildStoragePath(options, filename)
    
    // Convert to ArrayBuffer for upload
    const arrayBuffer = await file.arrayBuffer()
    
    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(options.bucket)
      .upload(storagePath, arrayBuffer, {
        contentType: mimeType,
        upsert: options.upsert ?? true,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return {
        success: false,
        error: uploadError.message,
      }
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(options.bucket)
      .getPublicUrl(storagePath)

    return {
      success: true,
      publicUrl: urlData.publicUrl,
      storagePath,
      fileSize: file.size,
    }
  } catch (error) {
    console.error('File upload error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }
  }
}

/**
 * Upload a buffer directly to Supabase Storage
 * 
 * @param buffer - The buffer to upload
 * @param mimeType - The MIME type of the content
 * @param options - Upload options
 * @returns Upload result with public URL
 */
export async function uploadBufferAsset(
  buffer: Buffer | ArrayBuffer,
  mimeType: string,
  options: UploadOptions
): Promise<UploadResult> {
  const supabase = createServiceClient()

  try {
    // Generate filename if not provided
    const extension = getExtensionFromMimeType(mimeType)
    const filename = options.filename || generateFilename('asset', extension)
    
    // Build full storage path
    const storagePath = buildStoragePath(options, filename)
    
    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(options.bucket)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: options.upsert ?? true,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return {
        success: false,
        error: uploadError.message,
      }
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(options.bucket)
      .getPublicUrl(storagePath)

    const bufferLength = buffer instanceof Buffer ? buffer.length : buffer.byteLength

    return {
      success: true,
      publicUrl: urlData.publicUrl,
      storagePath,
      fileSize: bufferLength,
    }
  } catch (error) {
    console.error('Buffer upload error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }
  }
}

/**
 * Parse a data URL and extract base64 data and MIME type
 * 
 * @param dataUrl - A data URL like "data:image/png;base64,iVBORw0KGgo..."
 * @returns Object with base64Data and mimeType, or null if invalid
 */
export function parseDataUrl(dataUrl: string): { base64Data: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  
  return {
    mimeType: match[1],
    base64Data: match[2],
  }
}

/**
 * Upload from a data URL (convenience method for AI-generated assets)
 * 
 * @param dataUrl - A data URL like "data:image/png;base64,..."
 * @param options - Upload options
 * @returns Upload result with public URL
 */
export async function uploadFromDataUrl(
  dataUrl: string,
  options: UploadOptions
): Promise<UploadResult> {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) {
    return {
      success: false,
      error: 'Invalid data URL format',
    }
  }
  
  return uploadBase64Asset(parsed.base64Data, parsed.mimeType, options)
}

/**
 * Delete an asset from storage
 * 
 * @param bucket - The storage bucket
 * @param storagePath - The full path to the file in storage
 * @returns Success status
 */
export async function deleteAsset(
  bucket: StorageBucket,
  storagePath: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient()

  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([storagePath])

    if (error) {
      console.error('Storage delete error:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Delete asset error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Delete failed',
    }
  }
}

/**
 * List assets in a folder
 * 
 * @param bucket - The storage bucket
 * @param folderPath - The folder path (e.g., "propertyId/photos")
 * @param limit - Maximum number of results
 * @returns List of files
 */
export async function listAssets(
  bucket: StorageBucket,
  folderPath: string,
  limit: number = 100
): Promise<{ files: Array<{ name: string; url: string; size: number }>; error?: string }> {
  const supabase = createServiceClient()

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folderPath, {
        limit,
        sortBy: { column: 'created_at', order: 'desc' },
      })

    if (error) {
      console.error('Storage list error:', error)
      return { files: [], error: error.message }
    }

    const files = (data || [])
      .filter(item => item.name && !item.name.endsWith('/')) // Filter out folders
      .map(item => {
        const fullPath = `${folderPath}/${item.name}`
        const { data: urlData } = supabase.storage
          .from(bucket)
          .getPublicUrl(fullPath)
        
        return {
          name: item.name,
          url: urlData.publicUrl,
          size: item.metadata?.size || 0,
        }
      })

    return { files }
  } catch (error) {
    console.error('List assets error:', error)
    return {
      files: [],
      error: error instanceof Error ? error.message : 'List failed',
    }
  }
}

/**
 * Save asset metadata to the content_assets table
 * 
 * @param metadata - Asset metadata
 * @returns The created asset record or error
 */
export async function saveAssetMetadata(
  metadata: AssetMetadata
): Promise<{ asset?: Record<string, unknown>; error?: string }> {
  const supabase = createServiceClient()

  try {
    const { data, error } = await supabase
      .from('content_assets')
      .insert({
        property_id: metadata.propertyId,
        name: metadata.name,
        description: metadata.description,
        asset_type: metadata.assetType,
        file_url: metadata.fileUrl,
        thumbnail_url: metadata.thumbnailUrl,
        file_size: metadata.fileSizeBytes,
        dimensions: {
          width: metadata.width,
          height: metadata.height,
          duration_seconds: metadata.durationSeconds,
          format: metadata.format,
          storage_path: metadata.storagePath,
          folder: metadata.folder,
        } as Json,
        is_ai_generated: metadata.isAiGenerated ?? false,
        generation_provider: metadata.generationProvider,
        generation_prompt: metadata.generationPrompt,
        generation_params: metadata.generationParams as Json | undefined,
        tags: metadata.tags || [],
      })
      .select()
      .single()

    if (error) {
      console.error('Save asset metadata error:', error)
      return { error: error.message }
    }

    return { asset: data }
  } catch (error) {
    console.error('Save metadata error:', error)
    return {
      error: error instanceof Error ? error.message : 'Save failed',
    }
  }
}

/**
 * Upload an AI-generated asset and save its metadata
 * This is the main method for ForgeStudio and similar products.
 * 
 * @param base64Data - The base64-encoded asset data
 * @param mimeType - The MIME type
 * @param options - Upload and metadata options
 * @returns The public URL and asset record
 */
export async function uploadAndSaveGeneratedAsset(
  base64Data: string,
  mimeType: string,
  options: {
    bucket: StorageBucket
    propertyId: string
    folder?: string
    name: string
    description?: string
    generationProvider: string
    generationPrompt?: string
    generationParams?: Record<string, unknown>
    tags?: string[]
    width?: number
    height?: number
    durationSeconds?: number
  }
): Promise<{ 
  success: boolean
  publicUrl?: string
  asset?: Record<string, unknown>
  error?: string 
}> {
  // First, upload to storage
  const uploadResult = await uploadBase64Asset(base64Data, mimeType, {
    bucket: options.bucket,
    propertyId: options.propertyId,
    folder: options.folder,
  })

  if (!uploadResult.success || !uploadResult.publicUrl) {
    return {
      success: false,
      error: uploadResult.error || 'Upload failed',
    }
  }

  // Then, save metadata to database
  const assetType = getAssetTypeFromMime(mimeType)
  const format = getExtensionFromMimeType(mimeType)

  const metadataResult = await saveAssetMetadata({
    propertyId: options.propertyId,
    name: options.name,
    description: options.description,
    assetType,
    fileUrl: uploadResult.publicUrl,
    storagePath: uploadResult.storagePath!,
    thumbnailUrl: assetType === 'image' ? uploadResult.publicUrl : undefined,
    fileSizeBytes: uploadResult.fileSize,
    width: options.width,
    height: options.height,
    durationSeconds: options.durationSeconds,
    format,
    isAiGenerated: true,
    generationProvider: options.generationProvider,
    generationPrompt: options.generationPrompt,
    generationParams: options.generationParams,
    tags: options.tags,
    folder: options.folder,
  })

  if (metadataResult.error) {
    // Asset was uploaded but metadata save failed
    // Return the URL anyway so the asset isn't lost
    console.error('Metadata save failed, but asset was uploaded:', metadataResult.error)
    return {
      success: true,
      publicUrl: uploadResult.publicUrl,
      error: `Asset uploaded but metadata save failed: ${metadataResult.error}`,
    }
  }

  return {
    success: true,
    publicUrl: uploadResult.publicUrl,
    asset: metadataResult.asset,
  }
}

// Export utility functions
export {
  getExtensionFromMimeType,
  getMimeTypeFromExtension,
  getAssetTypeFromMime,
  generateFilename,
  buildStoragePath,
}

















