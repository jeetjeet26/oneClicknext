import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { SiteForgeClientReview } from '@/components/siteforge/SiteForgeClientReview'
import { getRateLimitKey } from '@/utils/services/rate-limiter'
import { authorizeReviewSession } from '@/utils/siteforge/review/access'
import { SiteForgeReviewError, getPublicReviewData } from '@/utils/siteforge/review/service'
import { REVIEW_SESSION_COOKIE } from '@/utils/siteforge/review/session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Website review',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  referrer: 'no-referrer',
}

export default async function SiteForgeReviewPage() {
  try {
    const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
    const request = new Request('https://siteforge-review.local', {
      headers: new Headers(headerStore),
    })
    const access = await authorizeReviewSession(
      cookieStore.get(REVIEW_SESSION_COOKIE)?.value || null,
      'view',
      getRateLimitKey(request, 'siteforge-client-review'),
      { consumeAttempt: false }
    )
    const review = await getPublicReviewData(access.credential)
    return (
      <>
        <a
          href="#siteforge-review-content"
          className="sr-only z-50 rounded-md bg-background px-4 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to website review
        </a>
        <div id="siteforge-review-content" tabIndex={-1}>
          <SiteForgeClientReview initialReview={review} />
        </div>
      </>
    )
  } catch (error) {
    const message =
      error instanceof SiteForgeReviewError && error.statusCode === 410
        ? error.message
        : 'This review link is invalid or no longer available.'
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-muted/30 p-6"
        aria-labelledby="siteforge-review-error-title"
      >
        <section
          role="alert"
          aria-live="assertive"
          className="w-full max-w-lg rounded-xl border bg-background p-8 text-center shadow-sm"
        >
          <h1
            id="siteforge-review-error-title"
            tabIndex={-1}
            className="text-xl font-semibold focus:outline-none"
          >
            Website review unavailable
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">{message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Ask your SiteForge contact for a new review link.
          </p>
        </section>
      </main>
    )
  }
}
