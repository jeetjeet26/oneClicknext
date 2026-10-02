import type {Database,Json} from '@/types/supabase'
import type {SupabaseClient} from '@supabase/supabase-js'
export type ActionEvent={id:string;episode_id:string;property_id:string;actor_id:string|null;service_principal:string|null;product:string;action:string;evidence:'browser_observed'|'server_confirmed';phase:'observed'|'succeeded'|'failed';request:Json;before_state:Json;after_state:Json;result?:Json;created_at:string;shared_job_ref:string|null;shared_attempt_ref:string|null;context_snapshot_ref:string|null}
type ActionDatabase=Omit<Database,'public'> & {public:Omit<Database['public'],'Functions'|'Tables'> & {
 Functions:Database['public']['Functions'] & {
  disconnect_recorded_email:{Args:{p_property_id:string;p_actor_id:string;p_request_id:string;p_provider?:string};Returns:Json}
  disconnect_recorded_calendar:{Args:{p_property_id:string;p_actor_id:string;p_request_id:string;p_provider?:string};Returns:Json}
  read_luma_configuration:{Args:{p_property_id:string};Returns:Json}
  save_recorded_luma_configuration:{Args:{p_property_id:string;p_actor_id:string;p_request_id:string;p_operation:string;p_config:Json;p_expected_revision:string};Returns:Json}
  set_recorded_tour_timezone:{Args:{p_property_id:string;p_actor_id:string;p_request_id:string;p_timezone:string};Returns:Json}
  tour_calendar_schedules:{Args:{p_property_id:string;p_lead_id:string};Returns:Json}
  tour_booking_context:{Args:{p_property_id:string};Returns:Json}
  book_recorded_console_tour:{Args:{p_property_id:string;p_lead_id:string;p_actor_id:string;p_request_id:string;p_input:Json};Returns:Json}
  apply_recorded_tour_action:{Args:{p_property_id:string;p_lead_id:string;p_source:string;p_tour_id:string;p_actor_id:string;p_request_id:string;p_action:string;p_input:Json};Returns:Json}
  review_recorded_tour_reminder:{Args:{p_property_id:string;p_lead_id:string;p_channel_id:string;p_actor_id:string;p_request_id:string;p_input:Json};Returns:Json}
  append_shared_action_event:{Args:{p_id:string;p_episode_id:string;p_property_id:string;p_actor_id:string;p_product:string;p_action:string;p_evidence:string;p_phase:string;p_request:Json;p_before:Json;p_after:Json;p_result:Json;p_links?:Json};Returns:Json}
  control_recorded_workflow:{Args:{p_property_id:string;p_lead_id:string;p_workflow_id:string;p_actor_id:string;p_action:string;p_request_id:string};Returns:Json}
  review_recorded_workflow_delivery:{Args:{p_property_id:string;p_lead_id:string;p_delivery_id:string;p_actor_id:string;p_request_id:string;p_input:Json};Returns:Json}
 },Tables:Database['public']['Tables'] & {shared_action_events:{Row:ActionEvent;Insert:never;Update:never;Relationships:[]}}
}}
export const actionHistoryDb=(db:SupabaseClient<Database>)=>db as unknown as SupabaseClient<ActionDatabase>
