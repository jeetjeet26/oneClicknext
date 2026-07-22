/**
 * ForgeStudio secret encryption.
 *
 * AES-256-GCM with a key derived from the required ENCRYPTION_KEY environment
 * variable. There is intentionally no default key: storing social tokens or
 * app secrets without a real key is a hard failure, not a silent downgrade.
 *
 * Format: `encv1:<iv b64>:<auth tag b64>:<ciphertext b64>`
 * Legacy `enc_<b64>` values (plain base64, produced by an early prototype)
 * are still readable so that existing rows can be migrated on read.
 */

import crypto from 'node:crypto'

const ENCRYPTED_PREFIX = 'encv1:'
const LEGACY_PREFIX = 'enc_'

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'ENCRYPTION_KEY is required to encrypt/decrypt ForgeStudio social secrets'
    )
  }
  if (secret === 'p11-platform-default-key-change-me') {
    throw new Error(
      'ENCRYPTION_KEY is still set to the retired default value; set a real secret'
    )
  }
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptSecret(stored: string): string {
  if (stored.startsWith(LEGACY_PREFIX)) {
    return Buffer.from(stored.slice(LEGACY_PREFIX.length), 'base64').toString('utf-8')
  }

  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    // Pre-encryption plaintext row; return as-is so it can be re-encrypted on write.
    return stored
  }

  const key = getEncryptionKey()
  const [, ivB64, tagB64, dataB64] = stored.split(':')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted secret value')
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf-8')
}

export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_PREFIX)
}
