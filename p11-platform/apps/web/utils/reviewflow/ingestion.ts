import {createHash} from 'node:crypto'
/** Retained identity contract for legacy and recorded review sources. */
export function reviewContentFingerprint(input: {
  platform: string
  reviewerName: string | null
  reviewDate: string | null
  reviewText: string
  rating: number | null
}): string {
  const canonical = [
    input.platform,
    (input.reviewerName || '').trim().toLowerCase(),
    (input.reviewDate || '').slice(0, 10),
    (input.reviewText || '').trim(),
    String(input.rating ?? ''),
  ].join('\u241f')
  return createHash('sha256').update(canonical).digest('hex')
}
