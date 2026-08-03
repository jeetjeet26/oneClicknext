// SiteForge Imagen Client
// Shared utility for Google Vertex AI Imagen 3 image generation
// Extracted from BrandForge implementation for reuse
// Created: December 16, 2025
// Updated: Added quota tracking and retry logic

import { GoogleAuth } from 'google-auth-library'
import { createClient } from '@supabase/supabase-js'
import path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Initialize Google Auth for Vertex AI Imagen
let vertexAuth: GoogleAuth | null = null
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID

// Track quota exhaustion to avoid hammering the API
let quotaExhausted = false

/**
 * Reset the quota exhaustion flag
 * Call this at the start of a new generation session
 */
export function resetQuotaFlag(): void {
  quotaExhausted = false
}

/**
 * Check if quota is currently exhausted
 */
export function isQuotaExhausted(): boolean {
  return quotaExhausted
}

if (process.env.GOOGLE_APPLICATION_CREDENTIALS && projectId) {
  try {
    const credentialsPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
    vertexAuth = new GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
  } catch (error) {
    console.warn('Failed to initialize Vertex AI auth:', error)
  }
}

export interface ImageGenerationOptions {
  aspectRatio?: '1:1' | '16:9' | '4:3' | '3:4' | '9:16'
  negativePrompt?: string
  sampleCount?: number
}

export interface GeneratedImage {
  base64Data: string
  mimeType: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

/**
 * Check if Imagen is configured and available
 */
export function isImagenAvailable(): boolean {
  return !!(vertexAuth && projectId)
}

/**
 * Generate images using Vertex AI Imagen 3
 * @param prompt - The image generation prompt
 * @param options - Generation options (aspect ratio, negative prompt, sample count)
 * @returns Array of generated images with base64 data
 */
export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<GeneratedImage[]> {
  if (!vertexAuth || !projectId) {
    throw new Error('Vertex AI not configured. Set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS.')
  }

  const client = await vertexAuth.getClient()
  const accessToken = await client.getAccessToken()
  
  if (!accessToken.token) {
    throw new Error('Failed to get access token for Vertex AI')
  }

  const requestBody = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: options.sampleCount || 1,
      aspectRatio: options.aspectRatio || '1:1',
      personGeneration: 'allow_adult',
      negativePrompt: options.negativePrompt
    }
  }

  const location = 'us-central1'
  const modelId = 'imagen-3.0-generate-002'
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`

  console.log(`🎨 Generating image with Imagen 3.0...`)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken.token}`
    },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    const errorData = asRecord(await response.json().catch(() => ({})))
    const apiError = asRecord(errorData.error)
    const errorMessage =
      typeof apiError.message === 'string'
        ? apiError.message
        : `Image generation failed: ${response.status}`
    const errorCode =
      typeof apiError.code === 'number' || typeof apiError.code === 'string'
        ? apiError.code
        : response.status
    
    console.error('Imagen API error:', { code: errorCode, message: errorMessage })
    
    // Check for quota/rate limit errors
    if (errorCode === 429 || errorMessage.includes('Quota exceeded') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      quotaExhausted = true
      console.warn('⚠️ Imagen quota exhausted - will skip remaining image generations')
    }
    
    throw new Error(errorMessage)
  }

  const data = asRecord(await response.json())
  const predictions = Array.isArray(data.predictions) ? data.predictions : []
  
  // Handle empty predictions (may be content filtered or other issue)
  if (predictions.length === 0) {
    console.warn('⚠️ Imagen returned no images (may be content filtered or quota issue)')
    return []
  }
  
  return predictions
    .map(asRecord)
    .filter(
      (prediction): prediction is UnknownRecord & { bytesBase64Encoded: string } =>
        typeof prediction.bytesBase64Encoded === 'string'
    )
    .map(prediction => ({
      base64Data: prediction.bytesBase64Encoded,
      mimeType:
        typeof prediction.mimeType === 'string'
          ? prediction.mimeType
          : 'image/png'
    }))
}

/**
 * Generate images with retry logic for rate limiting
 * Uses exponential backoff for 429 errors
 */
export async function generateImageWithRetry(
  prompt: string,
  options: ImageGenerationOptions = {},
  maxRetries: number = 2
): Promise<GeneratedImage[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await generateImage(prompt, options)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      // Check if it's a rate limit error (not quota exhaustion)
      if (errorMessage.includes('429') && !errorMessage.includes('Quota exceeded')) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 5000 // 5s, 10s
          console.warn(`⏳ Imagen rate limited, waiting ${delay / 1000}s before retry (attempt ${attempt + 1}/${maxRetries})...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
      }
      
      // For quota exhaustion or other errors, don't retry
      throw error
    }
  }
  
  return []
}

/**
 * Upload generated image to Supabase storage
 * @param base64Data - Base64 encoded image data
 * @param mimeType - Image MIME type
 * @param filename - Filename without extension
 * @param folder - Storage folder path
 * @returns Public URL of the uploaded image
 */
export async function uploadToStorage(
  base64Data: string,
  mimeType: string,
  filename: string,
  folder: string
): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64')
  const extension = mimeType.includes('png') ? 'png' : 'jpg'
  const fullPath = `${folder}/${filename}.${extension}`

  const { error } = await supabase.storage
    .from('brand-assets')
    .upload(fullPath, buffer, {
      contentType: mimeType,
      upsert: true
    })

  if (error) {
    console.error('Storage upload error:', error)
    throw new Error('Failed to upload image to storage')
  }

  const { data: { publicUrl } } = supabase.storage
    .from('brand-assets')
    .getPublicUrl(fullPath)

  return publicUrl
}

/**
 * Generate and upload a single image
 * Convenience function that combines generation and upload
 * Includes quota check to avoid unnecessary API calls
 */
export async function generateAndUploadImage(
  prompt: string,
  options: ImageGenerationOptions & { 
    filename: string
    folder: string 
  }
): Promise<string | null> {
  // Skip if quota is already exhausted
  if (quotaExhausted) {
    console.log('⚠️ Imagen quota exhausted, skipping generation')
    return null
  }
  
  try {
    // Use retry-enabled generation
    const images = await generateImageWithRetry(prompt, options)
    
    if (images.length === 0) {
      console.warn('⚠️ No images generated (may be content filtered)')
      return null
    }

    const url = await uploadToStorage(
      images[0].base64Data,
      images[0].mimeType,
      options.filename,
      options.folder
    )

    console.log(`✅ Image uploaded: ${url}`)
    return url
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    // Check if this error should mark quota as exhausted
    if (errorMessage.includes('Quota exceeded') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      quotaExhausted = true
    }
    
    console.error('Generate and upload failed:', error)
    return null
  }
}

/**
 * Build a lifestyle photo prompt for real estate
 */
export function buildLifestylePhotoPrompt(
  scene: string,
  brandContext: {
    photoStyle?: {
      lighting?: string
      composition?: string
      subjects?: string
      mood?: string
    }
    targetAudience?: {
      demographics?: string
    }
  }
): string {
  const photoStyle = brandContext.photoStyle || {}
  const demographics = brandContext.targetAudience?.demographics || 'diverse residents'

  return `Professional lifestyle photography for luxury apartment community.

Scene: ${scene}
Subjects: ${demographics} naturally enjoying the space
Lighting: ${photoStyle.lighting || 'warm natural golden hour lighting'}
Composition: ${photoStyle.composition || 'magazine-quality, authentic candid moments'}
Mood: ${photoStyle.mood || 'aspirational, warm, welcoming'}

Style requirements:
- Professional real estate photography quality
- Natural, authentic interactions (not posed or staged)
- High resolution, 4K quality
- No text, watermarks, or logos
- Magazine-quality color grading`
}









