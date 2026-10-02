import type {Database} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'

// Narrow migration adapter until Phase 6 reconciles all generated schema types.
type BookingTable = Database['public']['Tables']['tour_bookings']
type CalendarDatabase = Omit<Database, 'public'> & {public: Omit<Database['public'], 'Tables'> & {
  Tables: Omit<Database['public']['Tables'], 'tour_bookings'> & {tour_bookings: Omit<BookingTable, 'Row' | 'Insert' | 'Update'> & {
    Row: BookingTable['Row'] & {schedule_timezone: string | null; schedule_version: number}
    Insert: BookingTable['Insert'] & {schedule_timezone?: string | null}
    Update: BookingTable['Update'] & {schedule_timezone?: string | null}
  }}
}}
export const tourCalendarDb = (db: SupabaseClient<Database>) => db as unknown as SupabaseClient<CalendarDatabase>
