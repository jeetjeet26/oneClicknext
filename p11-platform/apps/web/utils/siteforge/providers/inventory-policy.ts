const SYNTHETIC_INVENTORY_PATTERN =
  /(?:^|[^a-z])(demo|example|fake|mock|placeholder|seed|synthetic|test)(?:[^a-z]|$)/i

export function isSyntheticInventorySource(input: {
  source: string | null
  source_identity: string | null
}): boolean {
  return SYNTHETIC_INVENTORY_PATTERN.test(
    `${input.source || ''} ${input.source_identity || ''}`
  )
}
