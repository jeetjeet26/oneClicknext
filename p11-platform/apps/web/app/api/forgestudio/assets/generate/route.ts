import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { GoogleAuth } from 'google-auth-library'
import path from 'path'
import { 
  uploadAndSaveGeneratedAsset, 
  STORAGE_BUCKETS 
} from '@/utils/storage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Initialize Google Auth for Vertex AI (for images and videos)
let vertexAuth: GoogleAuth | null = null
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID

if (process.env.GOOGLE_APPLICATION_CREDENTIALS && projectId) {
  const credentialsPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
  vertexAuth = new GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  })
}

// Generate image using Vertex AI Imagen
async function generateWithGemini(
  prompt: string,
  params: {
    style?: string
    aspectRatio?: string
    negativePrompt?: string
  }
): Promise<{ 
  url: string
  base64Data?: string
  mimeType?: string
}> {
  // Use Vertex AI for image generation (more reliable than Gemini API for Imagen)
  if (!vertexAuth || !projectId) {
    throw new Error('Vertex AI not configured. Please add GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS.')
  }

  try {
    const client = await vertexAuth.getClient()
    const accessToken = await client.getAccessToken()
    
    if (!accessToken.token) {
      throw new Error('Failed to get access token for Vertex AI')
    }

    // Build the enhanced prompt with style
    let enhancedPrompt = prompt
    if (params.style) {
      const styleMap: Record<string, string> = {
        'natural': 'photorealistic, natural lighting, high quality photograph',
        'luxury': 'luxury, premium, elegant, sophisticated, high-end',
        'modern': 'modern, minimalist, clean lines, contemporary design',
        'vibrant': 'vibrant colors, colorful, bright, eye-catching',
        'cozy': 'cozy, warm tones, comfortable, inviting atmosphere',
        'professional': 'professional, corporate, business-like, polished'
      }
      enhancedPrompt = `${prompt}. Style: ${styleMap[params.style] || params.style}`
    }

    const requestBody: Record<string, unknown> = {
      instances: [{ prompt: enhancedPrompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: params.aspectRatio || '1:1',
        personGeneration: 'allow_adult'
      }
    }

    if (params.negativePrompt) {
      // @ts-expect-error - adding negativePrompt
      requestBody.parameters.negativePrompt = params.negativePrompt
    }

    const location = 'us-central1'
    const modelId = 'imagen-3.0-generate-002'
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`

    console.log('Starting Vertex AI image generation...')
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken.token}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Vertex AI Imagen error:', errorData)
      throw new Error(errorData.error?.message || `Image generation failed: ${response.status}`)
    }

    const data = await response.json()
    const predictions = data.predictions || []
    
    if (predictions.length > 0 && predictions[0].bytesBase64Encoded) {
      const base64Data = predictions[0].bytesBase64Encoded
      const mimeType = predictions[0].mimeType || 'image/png'
      
      return {
        url: `data:${mimeType};base64,${base64Data}`,
        base64Data,
        mimeType
      }
    }

    throw new Error('No image data in response')
  } catch (error) {
    console.error('Vertex AI image generation error:', error)
    throw error
  }
}

// Generate video using Vertex AI Veo 3 (Latest: Dec 2025)
// Veo 3 features: Enhanced realism, native audio generation, improved prompt adherence, realistic physics
async function generateVideoWithVertexAI(
  prompt: string,
  params: {
    style?: string
    aspectRatio?: string
    sourceImageUrl?: string
    negativePrompt?: string
    videoDuration?: 4 | 6 | 8
    includeAudio?: boolean
  }
): Promise<{ 
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  durationSeconds?: number
}> {
  if (!vertexAuth || !projectId) {
    throw new Error('Vertex AI not configured. Please add GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS to your environment variables.')
  }

  try {
    // Get access token from service account
    const client = await vertexAuth.getClient()
    const accessToken = await client.getAccessToken()
    
    if (!accessToken.token) {
      throw new Error('Failed to get access token for Vertex AI')
    }

    let enhancedPrompt = prompt
    if (params.style) {
      const styleMap: Record<string, string> = {
        'natural': 'photorealistic, natural lighting, smooth camera movement',
        'luxury': 'luxury, premium, elegant, sophisticated cinematic',
        'modern': 'modern, minimalist, clean lines, sleek transitions',
        'vibrant': 'vibrant colors, colorful, bright, energetic',
        'cozy': 'cozy, warm tones, comfortable, inviting atmosphere',
        'professional': 'professional, corporate, polished, high production value'
      }
      enhancedPrompt = `${prompt}. Style: ${styleMap[params.style] || params.style}`
    }

    // Prepare the request body for Veo
    const instance: Record<string, unknown> = { prompt: enhancedPrompt }
    
    // If source image provided for image-to-video
    if (params.sourceImageUrl) {
      const imageResponse = await fetch(params.sourceImageUrl)
      const imageBuffer = await imageResponse.arrayBuffer()
      const base64Image = Buffer.from(imageBuffer).toString('base64')
      const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg'
      instance.image = { 
        bytesBase64Encoded: base64Image,
        mimeType: mimeType
      }
    }

    const requestBody = {
      instances: [instance],
      parameters: {
        aspectRatio: params.aspectRatio === '9:16' ? '9:16' : '16:9',
        sampleCount: 1,
        durationSeconds: params.videoDuration || 8, // Veo 3 supports: 4, 6, or 8 seconds
        personGeneration: 'allow_adult',
        // Audio generation (default: true for Veo 3)
        generateAudio: params.includeAudio !== false
      }
    }

    if (params.negativePrompt) {
      // @ts-expect-error - adding negativePrompt
      requestBody.parameters.negativePrompt = params.negativePrompt
    }

    const location = 'us-central1'
    // Updated to Veo 3 (July 2025) - Available in paid preview
    // Model: veo-3.0-generate-preview
    // Features: Synchronized audio, cinematic quality, realistic physics
    const modelId = 'veo-3.0-generate-preview'
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`

    console.log('Starting Vertex AI video generation...')
    
    // Start video generation
    const generateResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken.token}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!generateResponse.ok) {
      const errorData = await generateResponse.json().catch(() => ({}))
      console.error('Vertex AI Veo error:', errorData)
      throw new Error(errorData.error?.message || `Video generation failed: ${generateResponse.status}`)
    }

    const operationData = await generateResponse.json()
    console.log('Video generation started, operation:', operationData.name)
    
    // Poll for completion (max 3 minutes for video)
    const maxAttempts = 36
    const pollInterval = 5000 // 5 seconds
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      
      // Use fetchPredictOperation to check status
      const pollEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:fetchPredictOperation`
      
      const statusResponse = await fetch(pollEndpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.token}`
        },
        body: JSON.stringify({
          operationName: operationData.name
        })
      })
      
      if (!statusResponse.ok) {
        console.log(`Poll attempt ${attempt + 1} failed, retrying...`)
        continue
      }
      
      const statusData = await statusResponse.json()
      console.log(`Poll attempt ${attempt + 1}: done=${statusData.done}`)
      
      if (statusData.done) {
        if (statusData.error) {
          throw new Error(statusData.error.message || 'Video generation failed')
        }
        
        // Extract video from response
        const videos = statusData.response?.videos || []
        if (videos.length > 0) {
          const video = videos[0]
          
          // Video can be base64 encoded or a GCS URI
          if (video.bytesBase64Encoded) {
            const mimeType = video.mimeType || 'video/mp4'
            return {
              url: `data:${mimeType};base64,${video.bytesBase64Encoded}`,
              thumbnailUrl: undefined,
              durationSeconds: params.videoDuration || 8
            }
          } else if (video.gcsUri) {
            return {
              url: video.gcsUri,
              thumbnailUrl: undefined,
              durationSeconds: params.videoDuration || 8
            }
          }
        }
        
        throw new Error('No video data in response')
      }
    }
    
    throw new Error('Video generation timed out. Please try again later.')
  } catch (error) {
    console.error('Vertex AI video generation error:', error)
    throw error
  }
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      propertyId,
      generationType, // 'text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'
      prompt,
      sourceImageUrl,
      style,
      quality,
      aspectRatio,
      negativePrompt,
      saveName,
      tags,
      folder,
      provider, // 'gemini' or 'nanobanana'
      // Video-specific settings
      videoDuration, // 4, 6, or 8 seconds
      includeAudio // boolean - whether to generate audio with video
    } = body

    if (!propertyId || !generationType || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: propertyId, generationType, prompt' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate generation type
    const validTypes = ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video']
    if (!validTypes.includes(generationType)) {
      return NextResponse.json(
        { error: 'Invalid generation type. Must be one of: ' + validTypes.join(', ') },
        { status: 400 }
      )
    }

    // For image-to-* types, require source image
    if ((generationType === 'image-to-image' || generationType === 'image-to-video') && !sourceImageUrl) {
      return NextResponse.json(
        { error: 'Source image URL required for image-based generation' },
        { status: 400 }
      )
    }

    let usedProvider = provider || 'gemini'
    const assetType = generationType.includes('video') ? 'video' : 'image'
    let publicUrl: string | undefined
    let thumbnailUrl: string | undefined
    let savedAsset: Record<string, unknown> | undefined

    // Route to appropriate model based on generation type
    if (generationType === 'text-to-image' || generationType === 'image-to-image') {
      // Use Gemini Imagen for image generation
      const result = await generateWithGemini(prompt, {
        style,
        aspectRatio,
        negativePrompt
      })
      usedProvider = 'gemini_imagen'
      
      // Upload to Supabase Storage and save metadata
      const uploadResult = await uploadAndSaveGeneratedAsset(
        result.base64Data!,
        result.mimeType!,
        {
          bucket: STORAGE_BUCKETS.CONTENT_ASSETS,
          propertyId,
          folder: folder || 'generated',
          name: saveName || `AI Generated ${assetType} - ${new Date().toISOString()}`,
          description: prompt,
          generationProvider: usedProvider,
          generationPrompt: prompt,
          generationParams: {
            type: generationType,
            style,
            quality,
            aspectRatio,
            negativePrompt,
            sourceImageUrl
          },
          tags: tags || ['ai-generated', 'forgestudio']
        }
      )
      
      if (!uploadResult.success) {
        return NextResponse.json({
          success: false,
          error: uploadResult.error || 'Failed to upload asset to storage'
        }, { status: 500 })
      }
      
      publicUrl = uploadResult.publicUrl
      thumbnailUrl = uploadResult.publicUrl // For images, thumbnail = image
      savedAsset = uploadResult.asset

    } else if (generationType === 'text-to-video' || generationType === 'image-to-video') {
      // Use Vertex AI Veo for video generation
      const result = await generateVideoWithVertexAI(prompt, {
        style,
        aspectRatio,
        sourceImageUrl,
        negativePrompt,
        videoDuration: videoDuration as 4 | 6 | 8 | undefined,
        includeAudio
      })
      usedProvider = 'vertex_ai_veo'
      
      // Check if we got base64 data or a GCS URI
      if (result.url.startsWith('data:')) {
        // Extract base64 from data URL
        const match = result.url.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const mimeType = match[1]
          const base64Data = match[2]
          
          // Upload to Supabase Storage
          const uploadResult = await uploadAndSaveGeneratedAsset(
            base64Data,
            mimeType,
            {
              bucket: STORAGE_BUCKETS.CONTENT_ASSETS,
              propertyId,
              folder: folder || 'generated',
              name: saveName || `AI Generated Video - ${new Date().toISOString()}`,
              description: prompt,
              generationProvider: usedProvider,
              generationPrompt: prompt,
              generationParams: {
                type: generationType,
                style,
                quality,
                aspectRatio,
                negativePrompt,
                sourceImageUrl,
                videoDuration,
                includeAudio
              },
              tags: tags || ['ai-generated', 'forgestudio', 'video'],
              durationSeconds: result.durationSeconds
            }
          )
          
          if (!uploadResult.success) {
            return NextResponse.json({
              success: false,
              error: uploadResult.error || 'Failed to upload video to storage'
            }, { status: 500 })
          }
          
          publicUrl = uploadResult.publicUrl
          savedAsset = uploadResult.asset
        }
      } else if (result.url.startsWith('gs://')) {
        // GCS URI - the video is already stored in Google Cloud Storage
        // Save the reference to our database
        const { data: asset, error: assetError } = await supabase
          .from('content_assets')
          .insert({
            property_id: propertyId,
            name: saveName || `AI Generated Video - ${new Date().toISOString()}`,
            description: prompt,
            asset_type: 'video',
            file_url: result.url, // GCS URI
            duration_seconds: result.durationSeconds,
            is_ai_generated: true,
            generation_provider: usedProvider,
            generation_prompt: prompt,
            generation_params: {
              type: generationType,
              style,
              quality,
              aspectRatio,
              negativePrompt,
              sourceImageUrl,
              videoDuration,
              includeAudio
            },
            tags: tags || ['ai-generated', 'forgestudio', 'video'],
            folder: folder || 'generated'
          })
          .select()
          .single()
        
        if (assetError) {
          console.error('Error saving GCS video asset:', assetError)
        }
        
        publicUrl = result.url
        savedAsset = asset || undefined
      }
      
      thumbnailUrl = result.thumbnailUrl
    } else {
      return NextResponse.json(
        { error: 'Invalid generation type' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      generated: true,
      saved: !!savedAsset,
      asset: savedAsset,
      url: publicUrl,
      thumbnailUrl,
      provider: usedProvider
    })

  } catch (error) {
    console.error('Asset generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Asset generation failed' },
      { status: 500 }
    )
  }
}
