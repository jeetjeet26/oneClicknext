import {expect,it} from 'vitest'
import {normalizeIntakeRows} from './intake-parser'
import {matchSavedGoogleReviews} from './intake-matching'
const text='A detailed review of the property and leasing team with enough text to establish a reliable match.'
const row=normalizeIntakeRows([{platform:'google',platformReviewId:'maps-id',reviewerName:'Alex',reviewText:text,rating:5}]).reviews[0]
const saved={platform:'google',platform_review_id:'places-id',reviewer_name:'Alex',review_text:text,rating:5,review_date:'2026-01-01T00:00:00Z'}
it('matches across provider IDs while preserving saved identity and unknown dates',()=>expect(matchSavedGoogleReviews([row],[saved])[0]).toMatchObject({platformReviewId:'places-id',reviewDate:new Date(saved.review_date).toISOString()}))
it('holds identical text from a different author for review instead of silently skipping it',()=>expect(()=>matchSavedGoogleReviews([{...row,reviewerName:'New Name'}],[saved])).toThrow(/Possible existing/))
it('matches expanded reviews by a substantial original prefix',()=>expect(matchSavedGoogleReviews([{...row,reviewText:text+' An update.'}],[saved])[0].platformReviewId).toBe('places-id'))
it('holds ambiguous matches rather than inserting',()=>expect(()=>matchSavedGoogleReviews([row],[saved,{...saved,platform_review_id:'another'}])).toThrow(/Possible existing/))
it('holds changed content from an existing author rather than inserting',()=>expect(()=>matchSavedGoogleReviews([{...row,reviewText:'Different review'}],[saved])).toThrow(/Possible existing/))
it('allows genuinely new authors and text',()=>expect(matchSavedGoogleReviews([{...row,reviewerName:'Other',reviewText:'Different review'}],[saved])[0].platformReviewId).toBe('maps-id'))
it('refuses two incoming rows resolving to one saved review',()=>expect(()=>matchSavedGoogleReviews([row,{...row,platformReviewId:'second'}],[saved])).toThrow(/Duplicate Google review|Two Google rows/))

it('holds duplicate new rows with different source IDs',()=>expect(()=>matchSavedGoogleReviews([row,{...row,platformReviewId:'new-id'}],[])).toThrow(/Duplicate Google review/))
it('matches a rating-only review to the same named reviewer and rating',()=>expect(matchSavedGoogleReviews([{...row,reviewText:''}],[{...saved,review_text:''}])[0].platformReviewId).toBe('places-id'))

it('matches short identical reviews only with the same named author',()=>expect(matchSavedGoogleReviews([{...row,reviewText:'Great tour'}],[{...saved,review_text:'Great tour'}])[0].platformReviewId).toBe('places-id'))

it('leaves every saved field untouched when an exact ID has changed remotely',()=>{
 const old={...saved,reviewer_avatar_url:'https://example.com/old.jpg'}
 const incoming={...row,platformReviewId:saved.platform_review_id,reviewText:'Edited remotely',rating:1,reviewerName:'Renamed',reviewDate:'2026-10-29T00:00:00Z',reviewerAvatarUrl:'https://example.com/new.jpg'}
 const matched=matchSavedGoogleReviews([incoming],[old])[0]
 expect(matched).toMatchObject({reviewText:old.review_text,rating:old.rating,reviewerName:old.reviewer_name,reviewDate:new Date(old.review_date).toISOString(),reviewerAvatarUrl:old.reviewer_avatar_url})
 expect(matchSavedGoogleReviews([matched],[old])).toEqual([matched])
})
