import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AdapterError,
  classifyHttpStatus,
  composeCaption,
  toAdapterError,
  type AdapterConnection,
  type AdapterVariant,
} from './types'
import { getAdapter, isChannelEnabled, normalizePlatform } from './index'
import { instagramAdapter, facebookAdapter } from './meta'
import { linkedinAdapter } from './linkedin'
import { xAdapter, weightedTweetLength } from './x'

function variant(overrides: Partial<AdapterVariant> = {}): AdapterVariant {
  return {
    caption: 'Pool season is open at The Landing.',
    hashtags: ['poolseason'],
    callToAction: null,
    linkUrl: null,
    mediaUrls: ['https://cdn.example.com/photo.jpg'],
    altText: 'Residents by the pool',
    contentFormat: 'image',
    platformOptions: {},
    ...overrides,
  }
}

function connection(overrides: Partial<AdapterConnection> = {}): AdapterConnection {
  return {
    id: 'conn-1',
    propertyId: 'prop-1',
    platform: 'instagram',
    accountId: 'acct-1',
    accessToken: 'token',
    refreshToken: null,
    tokenExpiresAt: null,
    pageId: null,
    pageAccessToken: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('error classification', () => {
  it('classifies HTTP statuses', () => {
    expect(classifyHttpStatus(429)).toBe('retryable')
    expect(classifyHttpStatus(500)).toBe('retryable')
    expect(classifyHttpStatus(503)).toBe('retryable')
    expect(classifyHttpStatus(408)).toBe('ambiguous')
    expect(classifyHttpStatus(400)).toBe('permanent')
    expect(classifyHttpStatus(401)).toBe('permanent')
    expect(classifyHttpStatus(403)).toBe('permanent')
  })

  it('treats network timeouts after send as ambiguous (must reconcile, never blind-retry)', () => {
    const afterSend = toAdapterError(new Error('fetch failed: timeout'), 'after_send')
    expect(afterSend.classification).toBe('ambiguous')

    const beforeSend = toAdapterError(new Error('socket hang up'), 'before_send')
    expect(beforeSend.classification).toBe('retryable')
  })

  it('treats non-network unknown errors as permanent and preserves AdapterError', () => {
    expect(toAdapterError(new Error('invalid payload'), 'after_send').classification).toBe('permanent')
    const original = new AdapterError('rate limited', 'retryable')
    expect(toAdapterError(original, 'after_send')).toBe(original)
  })
})

describe('composeCaption', () => {
  it('appends normalized hashtags', () => {
    expect(composeCaption(variant({ caption: 'Hello', hashtags: ['one', '#two'] }))).toBe(
      'Hello\n\n#one #two'
    )
  })

  it('omits the hashtag block when empty', () => {
    expect(composeCaption(variant({ caption: 'Hello', hashtags: [] }))).toBe('Hello')
  })
})

describe('launch gates', () => {
  it('normalizes twitter to x and rejects unknown platforms', () => {
    expect(normalizePlatform('twitter')).toBe('x')
    expect(normalizePlatform('x')).toBe('x')
    expect(normalizePlatform('myspace')).toBeNull()
  })

  it('keeps tiktok and x dark by default', () => {
    vi.stubEnv('FORGESTUDIO_CHANNEL_TIKTOK_ENABLED', '')
    vi.stubEnv('FORGESTUDIO_CHANNEL_X_ENABLED', '')
    expect(isChannelEnabled('tiktok')).toBe(false)
    expect(isChannelEnabled('x')).toBe(false)
    expect(isChannelEnabled('instagram')).toBe(true)
  })

  it('honors explicit env flags in both directions', () => {
    vi.stubEnv('FORGESTUDIO_CHANNEL_X_ENABLED', '1')
    vi.stubEnv('FORGESTUDIO_CHANNEL_INSTAGRAM_ENABLED', '0')
    expect(isChannelEnabled('x')).toBe(true)
    expect(isChannelEnabled('instagram')).toBe(false)
  })

  it('resolves adapters for every launch channel', () => {
    for (const platform of ['instagram', 'facebook', 'linkedin', 'tiktok', 'x']) {
      expect(getAdapter(platform)?.platform).toBe(platform)
    }
    expect(getAdapter('twitter')?.platform).toBe('x')
    expect(getAdapter('unknown')).toBeNull()
  })
})

describe('instagram preflight', () => {
  it('requires credentials', () => {
    expect(() =>
      instagramAdapter.preflight(connection({ accessToken: null, pageAccessToken: null }), variant())
    ).toThrowError(AdapterError)
  })

  it('requires media', () => {
    expect(() => instagramAdapter.preflight(connection(), variant({ mediaUrls: [] }))).toThrow(
      /image or video/i
    )
  })

  it('rejects unsafe media URLs', () => {
    expect(() =>
      instagramAdapter.preflight(
        connection(),
        variant({ mediaUrls: ['http://169.254.169.254/latest/meta-data'] })
      )
    ).toThrow()
  })

  it('accepts a valid image post', () => {
    expect(() => instagramAdapter.preflight(connection(), variant())).not.toThrow()
  })
})

describe('facebook preflight', () => {
  it('requires a page', () => {
    expect(() =>
      facebookAdapter.preflight(connection({ pageId: null, pageAccessToken: null }), variant())
    ).toThrowError(AdapterError)
  })

  it('accepts a text-only post with a page token', () => {
    expect(() =>
      facebookAdapter.preflight(
        connection({ pageId: 'page-1', pageAccessToken: 'page-token' }),
        variant({ mediaUrls: [], contentFormat: 'text' })
      )
    ).not.toThrow()
  })
})

describe('linkedin preflight', () => {
  it('requires an access token and an author', () => {
    expect(() =>
      linkedinAdapter.preflight(connection({ accessToken: null }), variant())
    ).toThrow(/access token/)
    expect(() =>
      linkedinAdapter.preflight(connection({ accountId: '', pageId: null }), variant())
    ).toThrow(/author/)
  })

  it('rejects posts over 3,000 characters', () => {
    expect(() =>
      linkedinAdapter.preflight(connection(), variant({ caption: 'a'.repeat(3001), hashtags: [] }))
    ).toThrow(/3,000/)
  })
})

describe('x weighted tweet length', () => {
  it('counts URLs as 23 characters regardless of length', () => {
    expect(weightedTweetLength('https://example.com/a-very-long-path-that-keeps-going')).toBe(23)
    expect(weightedTweetLength('hi https://example.com/x')).toBe(3 + 23)
  })

  it('counts CJK and emoji as 2', () => {
    expect(weightedTweetLength('日本語')).toBe(6)
    expect(weightedTweetLength('abc')).toBe(3)
  })

  it('rejects tweets over the weighted limit in preflight', () => {
    expect(() =>
      xAdapter.preflight(connection({ platform: 'x' }), variant({ caption: 'a'.repeat(300), hashtags: [] }))
    ).toThrow(/weighted characters/)
  })

  it('accepts a short tweet', () => {
    expect(() =>
      xAdapter.preflight(connection({ platform: 'x' }), variant({ mediaUrls: [] }))
    ).not.toThrow()
  })
})
