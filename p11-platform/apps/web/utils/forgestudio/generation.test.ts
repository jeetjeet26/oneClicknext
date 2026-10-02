import { describe, expect, it, vi } from 'vitest'
import {APICallError} from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import {
  GenerationClaimError,
  generateRevisionContent,
  type GenerationOutput,
} from './generation'
import type { TrustedContextBundle } from './context-assembler'

const ASSET_ID = '44444444-4444-4444-8444-444444444444'

const bundle: TrustedContextBundle = {
  version: 'forgestudio.context.v1',
  propertyId: 'prop-1',
  assembledAt: '2026-07-21T00:00:00.000Z',
  sources: [
    {
      id: 'property_field:name',
      kind: 'property_field',
      label: 'Property name',
      content: 'The Landing at Riverside',
      authority: 'authoritative',
      sensitivity: 'public',
      allowedUses: ['claim', 'topic'],
    },
    {
      id: 'structured_inventory:unit-1',
      kind: 'structured_inventory',
      label: 'Approved inventory',
      content: 'One month free on 12-month leases signed in August',
      authority: 'authoritative',
      approvalStatus: 'approved',
      sensitivity: 'sensitive',
      allowedUses: ['claim', 'topic'],
    },
  ],
  assets: [
    {
      id: ASSET_ID,
      name: 'Pool at sunset',
      assetType: 'image',
      fileUrl: 'https://cdn.example.com/pool.jpg',
      thumbnailUrl: null,
      description: 'Resort-style pool at golden hour',
      width: 1080,
      height: 1080,
      durationSeconds: null,
      altText: 'Pool at sunset',
      rightsStatus: 'owned',
      approvalStatus: 'approved',
      curationStatus: 'selected',
    },
  ],
  brandVoice: 'Warm and neighborly',
  targetAudience: null,
  warnings: [],
  policy: {
    legalConfigId: 'legal-1',
    fairHousingRequired: true,
    sensitiveClaimsRequireApproval: true,
  },
  contextHash: 'hash-123',
}

function makeModel(output: GenerationOutput) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 200, text: 200, reasoning: undefined },
      },
      warnings: [],
    },
  })
}

const validOutput: GenerationOutput = {
  conceptSummary: 'Golden-hour pool moments with an August leasing special.',
  variants: [
    {
      variantKey: 'instagram:image:1',
      sequenceIndex: 0,
      platform: 'instagram',
      caption: 'Golden hour hits different at The Landing.',
      hashtags: ['#poollife', 'apartmentliving'],
      callToAction: 'Book a tour',
      altText: 'Resort-style pool at sunset',
      contentFormat: 'image',
      selectedAssetId: ASSET_ID,
      selectedAssetIds: [ASSET_ID],
      storyboard: [],
      overlayText: [],
      safeArea: { topPercent: 10, rightPercent: 8, bottomPercent: 18, leftPercent: 8 },
      subtitleText: null,
      thumbnailAssetId: null,
    },
    {
      variantKey: 'facebook:text:1',
      sequenceIndex: 0,
      platform: 'facebook',
      caption: 'Summer evenings are better by the pool. Sign a 12-month lease in August and get one month free.',
      hashtags: [],
      callToAction: 'Schedule your visit',
      altText: null,
      contentFormat: 'text',
      selectedAssetId: null,
      selectedAssetIds: [],
      storyboard: [],
      overlayText: [],
      safeArea: { topPercent: 10, rightPercent: 8, bottomPercent: 18, leftPercent: 8 },
      subtitleText: null,
      thumbnailAssetId: null,
    },
  ],
  claims: [
    {
      text: 'One month free on 12-month leases signed in August',
      type: 'concession',
      sourceIds: ['structured_inventory:unit-1'],
    },
  ],
}

describe('generateRevisionContent', () => {
  it('maps structured output into contract content with citations and assets', async () => {
    const result = await generateRevisionContent({
      bundle,
      objective: 'Drive August tours',
      channels: ['instagram', 'facebook'],
      formatPlan: [
        { platform: 'instagram', contentFormat: 'image', quantity: 1 },
        { platform: 'facebook', contentFormat: 'text', quantity: 1 },
      ],
      model: makeModel(validOutput),
    })

    expect(result.content.conceptSummary).toBe(validOutput.conceptSummary)
    expect(result.content.variants).toHaveLength(2)

    const instagram = result.content.variants.find((variant) => variant.platform === 'instagram')!
    expect(instagram.assetIds).toEqual([ASSET_ID])
    expect(instagram.mediaUrls).toEqual(['https://cdn.example.com/pool.jpg'])
    // Hashtags are normalized without the # prefix.
    expect(instagram.hashtags).toEqual(['poollife', 'apartmentliving'])

    expect(result.content.claims[0].citations).toEqual([
      { sourceType: 'structured_inventory', sourceId: 'structured_inventory:unit-1' },
    ])

    expect(result.metadata.contextHash).toBe('hash-123')
    expect(result.metadata.promptVersion).toBe('forgestudio.generation.v2')
    expect(result.metadata.usage.totalTokens).toBe(300)
  })

  it('fails closed when a sensitive claim cites no valid source', async () => {
    const output: GenerationOutput = {
      ...validOutput,
      claims: [
        {
          text: 'Rents start at $1,200',
          type: 'pricing',
          sourceIds: ['kb_document:not-in-bundle'],
        },
      ],
    }

    await expect(
      generateRevisionContent({
        bundle,
        objective: 'Drive August tours',
        channels: ['instagram', 'facebook'],
        formatPlan: [
          { platform: 'instagram', contentFormat: 'image', quantity: 1 },
          { platform: 'facebook', contentFormat: 'text', quantity: 1 },
        ],
        model: makeModel(output),
      })
    ).rejects.toThrowError(GenerationClaimError)
  })

  it('fails when a requested channel is missing a variant', async () => {
    await expect(
      generateRevisionContent({
        bundle,
        objective: 'Drive August tours',
        channels: ['instagram', 'facebook', 'linkedin'],
        formatPlan: [
          { platform: 'instagram', contentFormat: 'image', quantity: 1 },
          { platform: 'facebook', contentFormat: 'text', quantity: 1 },
          { platform: 'linkedin', contentFormat: 'text', quantity: 1 },
        ],
        model: makeModel(validOutput),
      })
    ).rejects.toThrow(/did not produce variants for: linkedin/)
  })

  it('infers media content format when an asset is attached to a text variant', async () => {
    const output: GenerationOutput = {
      ...validOutput,
      variants: [
        { ...validOutput.variants[0], contentFormat: 'text' },
        validOutput.variants[1],
      ],
    }
    const result = await generateRevisionContent({
      bundle,
      objective: 'Drive August tours',
      channels: ['instagram', 'facebook'],
      formatPlan: [
        { platform: 'instagram', contentFormat: 'image', quantity: 1 },
        { platform: 'facebook', contentFormat: 'text', quantity: 1 },
      ],
      model: makeModel(output),
    })
    const instagram = result.content.variants.find((variant) => variant.platform === 'instagram')!
    expect(instagram.contentFormat).toBe('image')
  })

  it('creates multiple coordinated formats for the same channel', async () => {
    const instagram = validOutput.variants[0]
    const output: GenerationOutput = {
      ...validOutput,
      variants: [
        instagram,
        {
          ...instagram,
          variantKey: 'instagram:story:1',
          contentFormat: 'story',
          overlayText: ['Tour your next home'],
        },
      ],
    }
    const result = await generateRevisionContent({
      bundle,
      objective: 'Create a coordinated Instagram campaign',
      channels: ['instagram'],
      formatPlan: [
        { platform: 'instagram', contentFormat: 'image', quantity: 1 },
        { platform: 'instagram', contentFormat: 'story', quantity: 1 },
      ],
      model: makeModel(output),
    })

    expect(result.content.variants.map((variant) => variant.variantKey)).toEqual([
      'instagram:image:1',
      'instagram:story:1',
    ])
  })
})

describe('saved raw generation evidence',()=>{
 it('saves raw output and usage before rejecting unsupported claims',async()=>{
  const onResult=vi.fn().mockResolvedValue(undefined)
  const output={...validOutput,claims:[{text:'Invented price',type:'pricing' as const,sourceIds:['missing-source']}]}
  await expect(generateRevisionContent({bundle,objective:'Test raw evidence',channels:['facebook'],formatPlan:[{platform:'facebook',contentFormat:'text',quantity:1}],model:makeModel(output),onResult})).rejects.toBeInstanceOf(GenerationClaimError)
  expect(onResult).toHaveBeenCalledOnce();expect(onResult).toHaveBeenCalledWith(expect.objectContaining({output,metadata:expect.objectContaining({usage:expect.objectContaining({totalTokens:300}),contextHash:bundle.contextHash})}))
 })
 it('holds materialization if the raw result receipt cannot be saved',async()=>{
  const onResult=vi.fn().mockRejectedValue(new Error('Saved result unavailable'))
  await expect(generateRevisionContent({bundle,objective:'Test raw evidence',channels:['facebook'],formatPlan:[{platform:'facebook',contentFormat:'text',quantity:1}],model:makeModel(validOutput),onResult})).rejects.toThrow('Saved result unavailable');expect(onResult).toHaveBeenCalledOnce()
 })
})

it('does not retry a retryable model request behind the saved one-call intent',async()=>{
 let calls=0
 const model=new MockLanguageModelV4({doGenerate:async()=>{calls++;throw new APICallError({message:'Simulated unavailable provider',url:'https://provider.invalid',requestBodyValues:undefined,statusCode:503,isRetryable:true})}})
 await expect(generateRevisionContent({bundle,objective:'No silent retries',channels:['facebook'],formatPlan:[{platform:'facebook',contentFormat:'text',quantity:1}],model})).rejects.toThrow('Simulated unavailable provider');expect(calls).toBe(1)
})

import {buildGenerationPrompt} from './generation'
const settingsPlan=[{platform:'instagram' as const,contentFormat:'image' as const,quantity:1},{platform:'facebook' as const,contentFormat:'text' as const,quantity:1}]
it('includes exact saved channel preferences and the stricter caption limit in the prompt',()=>{
 const prompt=buildGenerationPrompt({bundle:{...bundle,channelSettings:{includeHashtags:false,includeCta:false,maxCaptionLength:150}},objective:'Introduce the community',channels:['instagram','facebook'],formatPlan:settingsPlan})
 expect(prompt.system).toContain('Set callToAction to null');expect(prompt.prompt).toContain('caption ≤ 150 chars');expect(prompt.prompt).toContain('≤ 0 hashtags')
})
it.each(['hashtags','caption hashtag','cta','caption limit'])('rejects generated content that violates saved %s preferences without changing its raw result',async(kind)=>{
 const output=structuredClone(validOutput);output.variants.forEach(v=>{v.hashtags=[];v.callToAction=null})
 if(kind==='hashtags')output.variants[0].hashtags=['unexpected'];if(kind==='caption hashtag')output.variants[0].caption+=' #unexpected';if(kind==='cta')output.variants[0].callToAction='Book a tour';if(kind==='caption limit')output.variants[0].caption='A'.repeat(181)
 const receipt=vi.fn();await expect(generateRevisionContent({bundle:{...bundle,channelSettings:{includeHashtags:false,includeCta:false,maxCaptionLength:180}},objective:'Introduce the community',channels:['instagram','facebook'],formatPlan:settingsPlan,model:makeModel(output),onResult:receipt})).rejects.toThrow(/saved studio/);expect(receipt).toHaveBeenCalledOnce()
})
it('materializes valid output under saved preferences without requiring optional hashtags or CTA',async()=>{
 const output=structuredClone(validOutput);output.variants.forEach(v=>{v.hashtags=[];v.callToAction=null});const result=await generateRevisionContent({bundle:{...bundle,channelSettings:{includeHashtags:false,includeCta:false,maxCaptionLength:180}},objective:'Introduce the community',channels:['instagram','facebook'],formatPlan:settingsPlan,model:makeModel(output)});expect(result.content.variants.every(v=>v.hashtags.length===0&&v.callToAction===null)).toBe(true)
})
