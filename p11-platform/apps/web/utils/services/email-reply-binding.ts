import type {SupabaseClient} from '@supabase/supabase-js'
import type {Database} from '@/types/supabase'
import {createServiceClient} from '@/utils/supabase/admin'
type ReplyDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{Functions:Database['public']['Functions']&{
 email_reply_matches_account:{Args:{p_property_id:string;p_email_id:string;p_thread_id:string|null;p_message_id:string|null};Returns:boolean}
}}}
export class EmailReplyAccountError extends Error {}
export async function assertEmailReplyAccount(config:{id:string;property_id:string},message:{threadId?:string;replyToMessageId?:string}){
 if(!message.threadId&&!message.replyToMessageId)return
 const db=createServiceClient() as unknown as SupabaseClient<ReplyDatabase>
 const {data,error}=await db.rpc('email_reply_matches_account',{p_property_id:config.property_id,p_email_id:config.id,p_thread_id:message.threadId||null,p_message_id:message.replyToMessageId||null})
 if(error)throw new Error('The reply account could not be checked. Retry after reloading the conversation.')
 if(data!==true)throw new EmailReplyAccountError('This conversation belongs to a different or retired email account. Its history is preserved. Start a new message from the current account to follow up.')
}
