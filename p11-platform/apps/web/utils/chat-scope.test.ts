import { describe, expect, it } from 'vitest'
import { isPropertyChatInScope } from './chat-scope'

describe('isPropertyChatInScope', () => {
  it('keeps broad selected-property prompts in scope', () => {
    expect(isPropertyChatInScope('tell me about acacia', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('tell me about it', 'Acacia')).toBe(true)
  })

  it('keeps contact-info replies in scope after lead capture prompts', () => {
    expect(isPropertyChatInScope('sure jesse gill jesse55555@gmail.com', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('call me at 5551112222', 'Acacia')).toBe(true)
  })

  it('still blocks explicit off-topic prompts', () => {
    expect(isPropertyChatInScope('teach me math', 'Acacia')).toBe(false)
    expect(isPropertyChatInScope('tell me about math', 'Acacia')).toBe(false)
  })
})
