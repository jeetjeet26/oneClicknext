import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import OpenAI from 'openai'
import { GoogleAuth } from 'google-auth-library'
import path from 'path'
import { 
  uploadAndSaveGeneratedAsset, 
  STORAGE_BUCKETS 
} from '@/utils/storage'
import { evaluateForgeStudioDraftReadiness } from '@/utils/services/forgestudio-draft-readiness'

const supabase = createServiceClient()

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
})

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
// Returns base64 data for storage upload (NOT a data URL)
async function generateWithGemini(
  prompt: string,
  params: {
    style?: string
    aspectRatio?: string
  }
): Promise<{ base64Data: string; mimeType: string }> {
  if (!vertexAuth || !projectId) {
    throw new Error('Vertex AI not configured')
  }

  try {
    const client = await vertexAuth.getClient()
    const accessToken = await client.getAccessToken()
    
    if (!accessToken.token) {
      throw new Error('Failed to get access token for Vertex AI')
    }

    let enhancedPrompt = prompt
    if (params.style) {
      const styleMap: Record<string, string> = {
        'natural': 'photorealistic, natural lighting, high quality photograph',
        'luxury': 'luxury, premium, elegant, sophisticated',
        'modern': 'modern, minimalist, clean lines',
        'vibrant': 'vibrant colors, colorful, bright',
        'cozy': 'cozy, warm tones, comfortable'
      }
      enhancedPrompt = `${prompt}. Style: ${styleMap[params.style] || params.style}`
    }

    const requestBody = {
      instances: [{ prompt: enhancedPrompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: params.aspectRatio || '1:1',
        personGeneration: 'allow_adult'
      }
    }

    const location = 'us-central1'
    const modelId = 'imagen-3.0-generate-002'
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`

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
      throw new Error(errorData.error?.message || `Image generation failed: ${response.status}`)
    }

    const data = await response.json()
    const predictions = data.predictions || []
    
    if (predictions.length > 0 && predictions[0].bytesBase64Encoded) {
      return {
        base64Data: predictions[0].bytesBase64Encoded,
        mimeType: predictions[0].mimeType || 'image/png'
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
// Returns base64 data for storage upload (NOT a data URL)
async function generateVideoWithVertexAI(
  prompt: string,
  params: {
    style?: string
    aspectRatio?: string
    sourceImageUrl?: string
  }
): Promise<{ base64Data: string; mimeType: string; gcsUri?: string }> {
  if (!vertexAuth || !projectId) {
    throw new Error('Vertex AI not configured. Please add GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS.')
  }

  try {
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
        'cozy': 'cozy, warm tones, comfortable, inviting atmosphere'
      }
      enhancedPrompt = `${prompt}. Style: ${styleMap[params.style] || params.style}`
    }

    const instance: Record<string, unknown> = { prompt: enhancedPrompt }
    
    if (params.sourceImageUrl) {
      const imageResponse = await fetch(params.sourceImageUrl)
      const imageBuffer = await imageResponse.arrayBuffer()
      const base64Image = Buffer.from(imageBuffer).toString('base64')
      const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg'
      instance.image = { bytesBase64Encoded: base64Image, mimeType }
    }

    const requestBody = {
      instances: [instance],
      parameters: {
        aspectRatio: params.aspectRatio === '9:16' ? '9:16' : '16:9',
        sampleCount: 1,
        durationSeconds: 8 // Veo 3 supports: 4, 6, or 8 seconds
      }
    }

    const location = 'us-central1'
    // Updated to Veo 3 (July 2025) - Available in paid preview
    // Model: veo-3.0-generate-preview
    // Features: Synchronized audio, cinematic quality, realistic physics
    const modelId = 'veo-3.0-generate-preview'
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`

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
      throw new Error(errorData.error?.message || `Video generation failed: ${generateResponse.status}`)
    }

    const operationData = await generateResponse.json()
    
    // Poll for completion
    const maxAttempts = 36
    const pollInterval = 5000
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      
      const pollEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:fetchPredictOperation`
      
      const statusResponse = await fetch(pollEndpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken.token}`
        },
        body: JSON.stringify({ operationName: operationData.name })
      })
      
      if (!statusResponse.ok) continue
      
      const statusData = await statusResponse.json()
      
      if (statusData.done) {
        if (statusData.error) {
          throw new Error(statusData.error.message || 'Video generation failed')
        }
        
        const videos = statusData.response?.videos || []
        if (videos.length > 0) {
          const video = videos[0]
          if (video.bytesBase64Encoded) {
            return {
              base64Data: video.bytesBase64Encoded,
              mimeType: video.mimeType || 'video/mp4'
            }
          } else if (video.gcsUri) {
            // If video is stored in GCS, return that URI
            return {
              base64Data: '',
              mimeType: 'video/mp4',
              gcsUri: video.gcsUri
            }
          }
        }
        throw new Error('No video data in response')
      }
    }
    
    throw new Error('Video generation timed out.')
  } catch (error) {
    console.error('Vertex AI video generation error:', error)
    throw error
  }
}

// Generate text content with GPT-4
async function generateTextContent(
  contentType: string,
  prompt: string,
  brandVoice?: string,
  creativityLevel: number = 0.7
): Promise<{
  caption: string
  hashtags: string[]
  callToAction: string
  variations: string[]
}> {
  const systemPrompt = `You are an expert social media and marketing content creator for multifamily real estate properties. 
${brandVoice ? `Brand Voice: ${brandVoice}` : 'Maintain a professional yet approachable tone.'}

Your content should:
- Be engaging and compelling
- Include relevant emojis when appropriate
- Drive action (tours, inquiries, applications)
- Be optimized for the target platform
- Feel authentic, not AI-generated

For each piece of content, provide:
1. Main caption/copy
2. Relevant hashtags (5-10)
3. A clear call-to-action
4. 2 alternative variations

Respond in JSON format:
{
  "caption": "main caption text",
  "hashtags": ["hashtag1", "hashtag2"],
  "callToAction": "CTA text",
  "variations": ["variation 1", "variation 2"]
}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: creativityLevel,
    response_format: { type: 'json_object' }
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No content generated')
  }

  return JSON.parse(content)
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await createServerClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      propertyId,
      contentType,
      platform,
      templateId,
      variables,
      generateMedia,
      mediaType,
      mediaPrompt,
      mediaStyle,
      sourceImageUrl
    } = body

    if (!propertyId || !contentType) {
      return NextResponse.json(
        { error: 'Missing required fields: propertyId, contentType' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get property details
    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('name, address, settings')
      .eq('id', propertyId)
      .single()

    if (propertyError || !property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      )
    }

    // Get ForgeStudio config
    const { data: config } = await supabase
      .from('forgestudio_config')
      .select('*')
      .eq('property_id', propertyId)
      .single()

    // Get template if specified
    let templatePrompt = ''
    if (templateId) {
      const { data: template } = await supabase
        .from('content_templates')
        .select('*')
        .eq('id', templateId)
        .single()

      if (template) {
        templatePrompt = template.prompt_template
        // Replace variables in template
        if (variables && typeof variables === 'object') {
          Object.entries(variables).forEach(([key, value]) => {
            templatePrompt = templatePrompt.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
          })
        }
      }
    }

    // Build the generation prompt
    const propertyName = property.name
    const amenities = config?.key_amenities?.join(', ') || ''
    
    const fullPrompt = templatePrompt || `
Create a ${contentType} for ${propertyName}${platform ? ` for ${platform}` : ''}.
${amenities ? `Key amenities to potentially highlight: ${amenities}` : ''}
${config?.target_audience ? `Target audience: ${config.target_audience}` : ''}
${variables?.topic ? `Topic/Theme: ${variables.topic}` : ''}
${variables?.details ? `Additional details: ${variables.details}` : ''}
`

    // Generate text content
    const textContent = await generateTextContent(
      contentType,
      fullPrompt,
      config?.brand_voice ?? undefined,
      config?.creativity_level || 0.7
    )

    // Generate media if requested
    let mediaUrls: string[] = []
    let thumbnailUrl: string | null = null
    let usedProvider = 'gemini'

    if (generateMedia && mediaPrompt) {
      try {
        const aspectRatio = platform === 'instagram' ? '1:1' : '16:9'
        
        // For images, try Gemini first (faster, better quality)
        if (mediaType === 'image' && !sourceImageUrl) {
          try {
            const geminiResult = await generateWithGemini(mediaPrompt, {
              style: mediaStyle || config?.nanobanana_default_style || undefined,
              aspectRatio
            })
            usedProvider = 'gemini_imagen'
            
            // Upload to Supabase Storage and save metadata
            const uploadResult = await uploadAndSaveGeneratedAsset(
              geminiResult.base64Data,
              geminiResult.mimeType,
              {
                bucket: STORAGE_BUCKETS.CONTENT_ASSETS,
                propertyId,
                folder: 'generated',
                name: `Generated Image - ${new Date().toISOString()}`,
                description: mediaPrompt,
                generationProvider: usedProvider,
                generationPrompt: mediaPrompt,
                generationParams: {
                  type: 'text-to-image',
                  style: mediaStyle,
                  aspectRatio
                },
                tags: ['ai-generated', 'forgestudio']
              }
            )
            
            if (uploadResult.success && uploadResult.publicUrl) {
              mediaUrls = [uploadResult.publicUrl]
              thumbnailUrl = uploadResult.publicUrl // For images, thumbnail = image
            } else {
              console.error('Failed to upload image to storage:', uploadResult.error)
              throw new Error(uploadResult.error || 'Image upload failed')
            }
          } catch (geminiError) {
            console.error('Gemini image generation failed:', geminiError)
            throw geminiError
          }
        } else if (mediaType === 'video') {
          // For videos, use Vertex AI Veo
          const videoResult = await generateVideoWithVertexAI(mediaPrompt, {
            style: mediaStyle || config?.nanobanana_default_style || undefined,
            aspectRatio,
            sourceImageUrl
          })
          usedProvider = 'vertex_ai_veo'

          // If video was returned as base64, upload to storage
          if (videoResult.base64Data) {
            const uploadResult = await uploadAndSaveGeneratedAsset(
              videoResult.base64Data,
              videoResult.mimeType,
              {
                bucket: STORAGE_BUCKETS.CONTENT_ASSETS,
                propertyId,
                folder: 'generated',
                name: `Generated Video - ${new Date().toISOString()}`,
                description: mediaPrompt,
                generationProvider: usedProvider,
                generationPrompt: mediaPrompt,
                generationParams: {
                  type: 'text-to-video',
                  style: mediaStyle,
                  aspectRatio,
                  sourceImageUrl
                },
                tags: ['ai-generated', 'forgestudio', 'video'],
                durationSeconds: 8
              }
            )
            
            if (uploadResult.success && uploadResult.publicUrl) {
              mediaUrls = [uploadResult.publicUrl]
            } else {
              console.error('Failed to upload video to storage:', uploadResult.error)
              throw new Error(uploadResult.error || 'Video upload failed')
            }
          } else if (videoResult.gcsUri) {
            // Video is already stored in GCS
            mediaUrls = [videoResult.gcsUri]
          }
        } else if (sourceImageUrl) {
          // For image-to-image, use Gemini with source image
          const geminiResult = await generateWithGemini(
            `Transform this image: ${mediaPrompt}`,
            {
              style: mediaStyle || config?.nanobanana_default_style || undefined,
              aspectRatio
            }
          )
          usedProvider = 'gemini_imagen'
          
          // Upload to storage
          const uploadResult = await uploadAndSaveGeneratedAsset(
            geminiResult.base64Data,
            geminiResult.mimeType,
            {
              bucket: STORAGE_BUCKETS.CONTENT_ASSETS,
              propertyId,
              folder: 'generated',
              name: `Transformed Image - ${new Date().toISOString()}`,
              description: mediaPrompt,
              generationProvider: usedProvider,
              generationPrompt: mediaPrompt,
              generationParams: {
                type: 'image-to-image',
                style: mediaStyle,
                sourceImageUrl
              },
              tags: ['ai-generated', 'forgestudio', 'transformed']
            }
          )
          
          if (uploadResult.success && uploadResult.publicUrl) {
            mediaUrls = [uploadResult.publicUrl]
            thumbnailUrl = uploadResult.publicUrl
          } else {
            throw new Error(uploadResult.error || 'Image upload failed')
          }
        }
      } catch (mediaError) {
        console.error('Media generation failed:', mediaError)
        // Continue without media - don't fail the whole request
      }
    }

    // Create content draft
    const readiness = evaluateForgeStudioDraftReadiness({
      caption: textContent.caption,
      platform,
      contentType,
      mediaType: generateMedia ? mediaType : 'none',
      mediaUrls,
    })

    const { data: draft, error: draftError } = await supabase
      .from('content_drafts')
      .insert({
        property_id: propertyId,
        template_id: templateId || null,
        title: `${contentType} - ${platform || 'General'} - ${new Date().toLocaleDateString()}`,
        content_type: contentType,
        platform,
        caption: textContent.caption,
        hashtags: textContent.hashtags,
        call_to_action: textContent.callToAction,
        variations: textContent.variations,
        media_type: generateMedia ? mediaType : 'none',
        media_urls: mediaUrls,
        thumbnail_url: thumbnailUrl,
        ai_model: 'gpt-4o-mini',
        generation_prompt: fullPrompt,
        generation_params: {
          templateId,
          variables,
          creativityLevel: config?.creativity_level,
          readiness: {
            state: readiness.state,
            blockers: readiness.blockers,
          },
        },
        status: readiness.isReady ? 'pending_review' : 'draft_partial'
      })
      .select()
      .single()

    if (draftError) {
      console.error('Error creating draft:', draftError)
      return NextResponse.json(
        { error: 'Failed to save content draft' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      draft,
      content: textContent,
      mediaGenerated: mediaUrls.length > 0,
      draftReadiness: readiness,
    })

  } catch (error) {
    console.error('ForgeStudio generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Content generation failed' },
      { status: 500 }
    )
  }
}

