/** Releasing delivery requires an explicit configuration change after backlog review. */
export function isDeliveryPaused(): boolean {
  return process.env.OUTBOUND_DELIVERY_PAUSED?.trim().toLowerCase() !== 'false'
}
export const DELIVERY_PAUSED_MESSAGE = 'Outbound delivery is paused pending operator review.'
export function requireDeliveryEnabled(): void {
  if (isDeliveryPaused()) throw new Error(DELIVERY_PAUSED_MESSAGE)
}
