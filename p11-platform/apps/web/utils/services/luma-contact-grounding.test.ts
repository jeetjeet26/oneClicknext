import { describe, expect, it } from 'vitest'
import { groundVisitorContact } from './luma-contact-grounding'

describe('visitor contact grounding', () => {
  it('rejects assistant contact details and fabricated values', () => {
    const messages = [
      { role: 'assistant', content: 'Contact sales at (555) 222-3333 or sales@example.test.' },
      { role: 'user', content: 'How many bedrooms does Plan 2 have?' },
    ]
    expect(groundVisitorContact({ email: 'sales@example.test', phone: '5552223333' }, messages))
      .toEqual({ email: null, phone: null })
    expect(groundVisitorContact({ email: 'invented@example.test', phone: 5551112222 }, messages))
      .toEqual({ email: null, phone: null })
  })

  it('retains visitor contacts across formatting differences without inventing a country code', () => {
    const messages = [{ role: 'user', content: 'My email is Jane+home@Example.test; call me at +1 (555) 111-2222.' }]
    expect(groundVisitorContact({ email: 'jane+home@example.test', phone: '5551112222' }, messages))
      .toEqual({ email: 'jane+home@example.test', phone: '5551112222' })
    expect(groundVisitorContact({ phone: '+44 20 7946 0958' }, [{ role: 'user', content: 'My number is +44 (20) 7946-0958.' }]))
      .toEqual({ email: null, phone: '+44 20 7946 0958' })
  })

  it('checks each field independently and requires the entire contact value', () => {
    const messages = [{ role: 'user', content: 'Reach me at jane@example.test or 5551112222.' }]
    expect(groundVisitorContact({ email: 'jane@example.test', phone: '5552223333' }, messages))
      .toEqual({ email: 'jane@example.test', phone: null })
    expect(groundVisitorContact({ email: 'ane@example.test', phone: '1112222' }, messages))
      .toEqual({ email: null, phone: null })
    expect(groundVisitorContact(null, messages)).toEqual({ email: null, phone: null })
  })
})
