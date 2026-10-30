import {describe, expect, it} from 'vitest'
import {fillSuggestedMappings} from './mapping-suggestions'
describe('CRM suggestion review drafts', () => {
 it('fills empty fields while preserving reviewer choices and preventing destination collisions', () => {
  const saved = {email: 'CustomEmail', phone: ''}
  expect(fillSuggestedMappings(saved, [{source:'email',target:'Email'}, {source:'phone',target:'Mobile'}, {source:'notes',target:'CustomEmail'}], ['email','phone','notes'])).toEqual({email:'CustomEmail',phone:'Mobile'})
  expect(saved).toEqual({email:'CustomEmail',phone:''})
 })
 it('ignores unknown sources, invalid destinations and duplicate suggestions', () => {
  expect(fillSuggestedMappings({}, [{source:'secret',target:'Secret'}, {source:'email',target:'bad field'}, {source:'email',target:'Email'}, {source:'phone',target:'Email'}], ['email','phone'])).toEqual({email:'Email'})
 })
})
