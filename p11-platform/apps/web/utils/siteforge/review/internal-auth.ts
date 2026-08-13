import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  reviewRepository,
  type ReviewRepository,
  type ReviewSessionRow,
  type ReviewWebsite,
} from './repository'

export class ReviewAccessError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'ReviewAccessError'
  }
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    throw new ReviewAccessError('Unauthorized', 401)
  }
  return user
}

async function assertPropertyAccess(userId: string, propertyId: string) {
  const access = await validatePropertyAccess(userId, propertyId)
  if (!access.authorized) {
    throw new ReviewAccessError('Forbidden', 403)
  }
}

export async function requireWebsiteReviewAccess(
  websiteId: string,
  repository: Pick<ReviewRepository, 'getWebsite'> = reviewRepository
): Promise<{ userId: string; website: ReviewWebsite }> {
  const user = await requireUser()
  const website = await repository.getWebsite(websiteId)
  if (!website) {
    throw new ReviewAccessError('Website not found', 404)
  }
  await assertPropertyAccess(user.id, website.propertyId)
  return { userId: user.id, website }
}

export async function requireSessionReviewAccess(
  sessionId: string,
  repository: Pick<ReviewRepository, 'getSession'> = reviewRepository
): Promise<{ userId: string; session: ReviewSessionRow }> {
  const user = await requireUser()
  const session = await repository.getSession(sessionId)
  if (!session) {
    throw new ReviewAccessError('Review session not found', 404)
  }
  await assertPropertyAccess(user.id, session.property_id)
  return { userId: user.id, session }
}
