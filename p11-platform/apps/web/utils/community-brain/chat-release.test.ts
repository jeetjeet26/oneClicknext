import {beforeEach, describe, expect, it, vi} from 'vitest'
const mocks = vi.hoisted(() => ({rpc: vi.fn(), legacy: vi.fn(), brain: vi.fn()}))
vi.mock('./server', () => ({brainRpc: mocks.rpc}))
vi.mock('./public-context', () => ({currentPublicCommunityContext: mocks.brain}))
vi.mock('@/utils/services/chatbot-context-editor', () => ({loadPropertyChatbotContext: mocks.legacy}))
import {loadPublicChatContext} from './chat-release'
const db = {} as Parameters<typeof loadPublicChatContext>[0]
const request = {configId: 'config-a', sessionId: 'session-a', query: 'Available homes?'}
const context = {contextMarkdown: 'Reviewed community A facts', contextJson: {}, status: 'current', requiresReview: false, servingMode: 'full'}
beforeEach(() => {vi.resetAllMocks(); mocks.legacy.mockResolvedValue(context); mocks.brain.mockResolvedValue(context)})
describe('public chat release selection', () => {
  it('preserves the existing reviewed path until the community is adopted', async () => {
    mocks.rpc.mockResolvedValue({propertyId: 'a', mode: 'legacy', revision: 1})
    expect(await loadPublicChatContext(db, 'a', request)).toEqual({...context, chatRelease: {mode: 'legacy', revision: 1}})
    expect(mocks.legacy).toHaveBeenCalledWith(db, 'a'); expect(mocks.brain).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('brain_chat_release', {p_config_id: 'config-a', p_session_id: 'session-a'})
  })
  it('uses only the new community context after cutover', async () => {
    mocks.rpc.mockResolvedValue({propertyId: 'a', mode: 'brain', revision: 2})
    expect(await loadPublicChatContext(db, 'a', request)).toEqual({...context, chatRelease: {mode: 'brain', revision: 2}})
    expect(mocks.brain).toHaveBeenCalledWith('a', request); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('does not resurrect legacy facts when an adopted community is suspended', async () => {
    mocks.rpc.mockResolvedValue({propertyId: 'a', mode: 'withheld', revision: 3})
    expect(await loadPublicChatContext(db, 'a', request)).toBeNull()
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.brain).not.toHaveBeenCalled()
  })
  it('rejects a release bound to another community', async () => {
    mocks.rpc.mockResolvedValue({propertyId: 'b', mode: 'brain', revision: 2})
    await expect(loadPublicChatContext(db, 'a', request)).rejects.toThrow('another community')
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.brain).not.toHaveBeenCalled()
  })
  it('fails closed when release selection cannot be read', async () => {
    mocks.rpc.mockRejectedValue(new Error('Database unavailable'))
    await expect(loadPublicChatContext(db, 'a', request)).rejects.toThrow()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('does not fall back after a Brain retrieval error', async () => {
    mocks.rpc.mockResolvedValue({propertyId: 'a', mode: 'brain', revision: 2})
    mocks.brain.mockRejectedValue(new Error('Source withdrawn'))
    await expect(loadPublicChatContext(db, 'a', request)).rejects.toThrow('Source withdrawn')
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('preserves the legacy review hold', async () => {
    mocks.rpc.mockResolvedValue({propertyId: 'a', mode: 'legacy', revision: 1})
    mocks.legacy.mockResolvedValue({...context, servingMode: 'degraded', requiresReview: true})
    expect(await loadPublicChatContext(db, 'a', request)).toMatchObject({servingMode: 'degraded', requiresReview: true})
  })
})
