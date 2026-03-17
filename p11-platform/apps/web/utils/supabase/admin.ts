import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from './config'

export function createServiceClient() {
  return createClient<Database>(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey()
  )
}

// Alias for clarity when used in server-side code
export const createAdminClient = createServiceClient

