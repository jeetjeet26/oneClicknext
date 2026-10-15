import type {createServiceClient} from '@/utils/supabase/admin'
import {loadPropertyChatbotContext} from '@/utils/services/chatbot-context-editor'
import {currentPublicCommunityContext, type PublicCommunityRequest} from './public-context'
import {brainRpc} from './server'

/** Existing communities stay on their reviewed context until an explicit cutover.
 * After adoption, suspension or a failed Brain read never revives legacy facts.
 * The release revision is part of the model's before/after freshness checks.
 */
export async function loadPublicChatContext(
  db: ReturnType<typeof createServiceClient>, propertyId: string, request: PublicCommunityRequest,
) {
  const release = await brainRpc<{propertyId: string; mode: 'legacy' | 'brain' | 'withheld'; revision: number}>(
    'brain_chat_release', {p_config_id: request.configId, p_session_id: request.sessionId},
  )
  if (release.propertyId !== propertyId) throw new Error('Chat release belongs to another community.')
  if (release.mode === 'withheld') return null
  if (release.mode !== 'legacy' && release.mode !== 'brain') throw new Error('Chat release is unavailable.')
  const context = release.mode === 'brain'
    ? await currentPublicCommunityContext(propertyId, request)
    : await loadPropertyChatbotContext(db, propertyId)
  return context ? {...context, chatRelease: {mode: release.mode, revision: release.revision}} : null
}
