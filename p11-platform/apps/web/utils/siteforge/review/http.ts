import { z } from 'zod'
import { ReviewAccessError } from './internal-auth'
import { SiteForgeReviewError } from './service'

export type SafeReviewError = {
  status: number
  code: string
  message: string
}

export function safeReviewError(error: unknown): SafeReviewError {
  if (error instanceof SiteForgeReviewError) {
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
    }
  }
  if (error instanceof ReviewAccessError) {
    return {
      status: error.statusCode,
      code:
        error.statusCode === 401
          ? 'unauthorized'
          : error.statusCode === 403
            ? 'forbidden'
            : 'not_found',
      message: error.message,
    }
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      code: 'invalid_request',
      message: 'Invalid review request',
    }
  }
  return {
    status: 500,
    code: 'review_error',
    message: 'Review request could not be completed',
  }
}
