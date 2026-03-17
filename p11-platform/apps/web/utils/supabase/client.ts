import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { getSupabasePublishableKey, getSupabaseUrl } from './config'

export function createClient() {
  return createBrowserClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey()
  )
}



























