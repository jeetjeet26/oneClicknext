import { describe, expect, it } from 'vitest'
import { containsContactInfo, detectTourIntent, detectTourOffer, isPropertyChatInScope } from './chat-scope'

describe('isPropertyChatInScope', () => {
  it('keeps broad selected-property prompts in scope', () => {
    expect(isPropertyChatInScope('tell me about acacia', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('tell me about it', 'Acacia')).toBe(true)
  })

  it('keeps contact-info replies in scope after lead capture prompts', () => {
    expect(isPropertyChatInScope('sure jesse gill jesse55555@gmail.com', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('call me at 5551112222', 'Acacia')).toBe(true)
  })

  it('keeps property questions outside the keyword allowlist in scope', () => {
    expect(isPropertyChatInScope('Are the kitchen ranges gas or electric?', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('Is there central air conditioning?', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('What appliances are included?', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('Are washers and dryers included?', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('Is smoking allowed on the premises?', 'Acacia')).toBe(true)
  })

  it('defaults to in-scope for questions the blocklist does not match', () => {
    expect(isPropertyChatInScope('What direction do the windows face?', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('How tall are the ceilings?', 'Acacia')).toBe(true)
  })

  it('still blocks explicit off-topic prompts', () => {
    expect(isPropertyChatInScope('teach me math', 'Acacia')).toBe(false)
    expect(isPropertyChatInScope('tell me about math', 'Acacia')).toBe(false)
    expect(isPropertyChatInScope('help me debug my javascript function', 'Acacia')).toBe(false)
    expect(isPropertyChatInScope('write me a poem about the ocean', 'Acacia')).toBe(false)
    expect(isPropertyChatInScope('what do you think about politics today?', 'Acacia')).toBe(false)
  })

  it('lets property topic words override the blocklist', () => {
    expect(isPropertyChatInScope('is cooking gas included in the unit utilities?', 'Acacia')).toBe(true)
    expect(isPropertyChatInScope('does the community have a game room?', 'Acacia')).toBe(true)
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

describe('detectTourOffer', () => {
  it('detects assistant replies that bring up touring', () => {
    expect(detectTourOffer('I recommend scheduling a tour of Acacia to explore the community.')).toBe(true)
    expect(detectTourOffer('We have showings available this weekend!')).toBe(true)
    expect(detectTourOffer('Join us for the open house on Saturday.')).toBe(true)
  })

  it('ignores replies that do not mention touring', () => {
    expect(detectTourOffer('Homes at Acacia start at $2,595,000 with solar included.')).toBe(false)
    expect(detectTourOffer('The kitchen ranges are electric.')).toBe(false)
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
