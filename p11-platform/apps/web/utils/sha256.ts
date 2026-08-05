import { sha256 } from '@noble/hashes/sha2.js'

export function sha256Hex(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
