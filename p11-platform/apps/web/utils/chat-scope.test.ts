import { describe, expect, it } from 'vitest'
import { containsContactInfo, detectTourIntent, isPropertyChatInScope } from './chat-scope'

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

describe('detectTourIntent', () => {
  it('detects direct tour keywords without conversation context', () => {
    expect(detectTourIntent('Schedule a tour')).toBe(true)
    expect(detectTourIntent('can I book an appointment?')).toBe(true)
    expect(detectTourIntent('I want to visit the community')).toBe(true)
  })

  it('detects affirmative follow-ups after the assistant offers a tour', () => {
    const tourOffer = 'Would you like to schedule a tour of Acacia?'
    expect(detectTourIntent('I would love to. Is there availability next week?', tourOffer)).toBe(true)
    expect(detectTourIntent('yes please', tourOffer)).toBe(true)
    expect(detectTourIntent('sure, that works', tourOffer)).toBe(true)
  })

  it('detects scheduling follow-ups after the assistant offers a tour', () => {
    const tourOffer = 'I can help you book a tour!'
    expect(detectTourIntent('is there availability next week?', tourOffer)).toBe(true)
    expect(detectTourIntent('what times are open on saturday?', tourOffer)).toBe(true)
  })

  it('does not treat follow-ups as tour intent without a prior tour mention', () => {
    const pricingReply = 'Our homes are priced from $2,595,000.'
    expect(detectTourIntent('is there availability next week?', pricingReply)).toBe(false)
    expect(detectTourIntent('what do you have available?', pricingReply)).toBe(false)
    expect(detectTourIntent('what do you have available?')).toBe(false)
  })

  it('ignores non-affirmative replies after a tour offer', () => {
    const tourOffer = 'Would you like to schedule a tour?'
    expect(detectTourIntent('what is the HOA fee?', tourOffer)).toBe(false)
    expect(detectTourIntent('how much is plan 2?', tourOffer)).toBe(false)
  })
})

describe('containsContactInfo', () => {
  it('detects emails and phone numbers', () => {
    expect(containsContactInfo('Russell Yarwood - russell@p11.com')).toBe(true)
    expect(containsContactInfo('reach me at (555) 111-2222')).toBe(true)
    expect(containsContactInfo('call 5551112222')).toBe(true)
  })

  it('ignores messages without contact details', () => {
    expect(containsContactInfo('what bedcounts do you offer?')).toBe(false)
    expect(containsContactInfo('')).toBe(false)
  })
})
