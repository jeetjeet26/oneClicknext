import { expect, it } from 'vitest'
import { advertisedSalePrice } from './sale-prices'

const source = {sourceUrl: 'https://builder.example.com/current-community', fetchedAt: '2026-11-25T04:23:17Z'}

it.each([
  ['Welcome\nFrom $1,189,990\nPlus cost of solar; homesite premium may apply', 1189990],
  ['New Release\nFrom $849,990\nFloor Plans\nStarting From $947,990', 849990],
  ['New homes\nFrom $789,000\nFrom $789,000', 789000],
])('reads the advertised opening price from a retained builder page', (text, amount) => {
  expect(advertisedSalePrice({...source, text})).toMatchObject({amount, ...source})
})

it.each([
  'From $2,400\nMonthly lease',
  'Starting at $20,000 per month',
  'From $0,000,000',
  'Nearby Communities You Might Like\nFrom $799,990',
  'Financing example based on a $650,000 purchase price',
])('keeps an unverified sale price unknown', text => {
  expect(advertisedSalePrice({...source, text})).toBeNull()
})
