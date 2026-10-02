import type { Database,Json } from '@/types/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

type PhaseFourDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Functions'> & {
  Functions: Database['public']['Functions'] & {
    replace_website_knowledge: {Args: {p_property_id:string;p_scope:string;p_run_id:string;p_documents:Json;p_extracted:Json}; Returns:string}
    claim_phase_four_maintenance: {Args: {p_kind:string;p_limit:number}; Returns:Json}
    finish_phase_four_maintenance: {Args: {p_kind:string;p_item_id:string;p_token:string;p_success:boolean}; Returns:boolean}
    phase_four_status: {Args:{p_property_id:string}; Returns:Json}
    claim_luma_delivery: {Args: Record<string,never>; Returns: Json}
    save_luma_delivery: {Args: {p_id:string;p_token:string;p_stage:string;p_receipt:Json}; Returns:boolean}
    reserve_luma_allowance: {Args: {p_property_id:string; p_bucket:string; p_units:number; p_limit:number; p_expires_at:string}; Returns:boolean}
    claim_luma_request: {Args: {p_property_id:string;p_request_id:string;p_operation:string;p_input_hash:string;p_actor:string}; Returns:Json}
    finish_luma_request: {Args: {p_property_id:string;p_request_id:string;p_token:string;p_response:Json;p_status:number}; Returns:boolean}
    upsert_luma_lead: {Args: {p_property_id:string;p_email:string|null;p_phone:string|null;p_existing_id:string|null;p_create:Json;p_update:Json;p_activity:Json|null}; Returns:Json}
    save_luma_message: {Args: {p_property_id:string;p_conversation_id:string;p_role:string;p_content:string}; Returns:Json}
    reserve_luma_tour: {Args: {p_property_id:string;p_lead_id:string;p_booking:Json;p_delivery:Json}; Returns:Json}
    enqueue_geo_execution: { Args: {p_run_id: string}; Returns: Json }
  }
} }
export function phaseFourDb(client: SupabaseClient<Database>): SupabaseClient<PhaseFourDatabase> {
  return client as unknown as SupabaseClient<PhaseFourDatabase>
}
