import {expect,it} from 'vitest'
import {isHousingSteeringQuestion,isHousingSteeringAnswer} from './fair-housing'
it.each(['Is this a good area for families?', 'Is this community suitable for kids?', 'Is it a family-friendly neighborhood?', 'Would my family fit in?', 'Who lives here?', 'Is the neighborhood family-friendly?', 'Would our kids feel at home here?', 'Is this place welcoming for Muslims?'])('redirects suitability or composition: %s', text => expect(isHousingSteeringQuestion(text)).toBe(true))
it.each(['Does this building have good amenities for families?', 'Does the property have a playground for kids?', 'Is there a step-free route to the lobby?', 'Is there a school near this property?', 'Are there family-friendly activities at the property?', 'Is the community room available for a family party?'])('allows specific features: %s', text => expect(isHousingSteeringQuestion(text)).toBe(false))
it('screens generated suitability judgments while allowing factual features', () => {
  expect(isHousingSteeringAnswer('Yes, this is a great area for families.')).toBe(true)
  expect(isHousingSteeringAnswer('The property has a playground and two-bedroom floor plans.')).toBe(false)
})
