import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>d}))
import {assertEmailReplyAccount,EmailReplyAccountError} from './email-reply-binding'
beforeEach(()=>vi.resetAllMocks())
const config={id:'current-mailbox',property_id:'property'}
it('new conversations have no historical provider identity',async()=>{await assertEmailReplyAccount(config,{});expect(d.rpc).not.toHaveBeenCalled()})
it('replies require thread and message to belong to the selected account',async()=>{d.rpc.mockResolvedValue({data:true});await assertEmailReplyAccount(config,{threadId:'thread',replyToMessageId:'message'});expect(d.rpc).toHaveBeenCalledWith('email_reply_matches_account',{p_property_id:'property',p_email_id:'current-mailbox',p_thread_id:'thread',p_message_id:'message'})})
it.each([false,null,undefined])('blocks unknown or retired reply bindings %#',async data=>{d.rpc.mockResolvedValue({data});await expect(assertEmailReplyAccount(config,{threadId:'old-thread'})).rejects.toBeInstanceOf(EmailReplyAccountError)})
it('database failure is unavailable rather than permission to send',async()=>{d.rpc.mockResolvedValue({error:{message:'private database detail'}});await expect(assertEmailReplyAccount(config,{replyToMessageId:'old-message'})).rejects.toThrow('could not be checked')})
