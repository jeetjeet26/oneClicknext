import {
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from './config'

describe('supabase config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('prefers the publishable key when present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    expect(getSupabasePublishableKey()).toBe('publishable-key')
  })

  it('falls back to the legacy anon key', () => {
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    expect(getSupabasePublishableKey()).toBe('anon-key')
  })

  it('throws when the service role key is missing', () => {
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY')

    expect(() => getSupabaseServiceRoleKey()).toThrow(
      'SUPABASE_SERVICE_ROLE_KEY is not set'
    )
  })

  it('throws when the Supabase URL is missing', () => {
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SUPABASE_URL')

    expect(() => getSupabaseUrl()).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL is not set'
    )
  })
})
