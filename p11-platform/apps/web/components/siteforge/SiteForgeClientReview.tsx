'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  ACFBlockRenderer,
  type DesignSystem,
} from './ACFBlockRenderer'
import type {
  PublicReviewComment,
  PublicReviewData,
  ReviewDecision,
} from '@/utils/siteforge/review/contracts'

type Viewport = 'desktop' | 'tablet' | 'mobile'

const VIEWPORT_WIDTH: Record<Viewport, number | '100%'> = {
  mobile: 390,
  tablet: 768,
  desktop: '100%',
}

function statusVariant(status: string) {
  return ['approved', 'verified', 'resolved'].includes(status)
    ? 'success'
    : 'outline'
}

function CommentCard({
  comment,
  replies,
  onReply,
}: {
  comment: PublicReviewComment
  replies: PublicReviewComment[]
  onReply: (comment: PublicReviewComment) => void
}) {
  return (
    <article className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">{comment.authorName}</span>
        <div className="flex gap-2">
          <Badge variant="secondary">{comment.category}</Badge>
          <Badge variant={statusVariant(comment.status)}>
            {comment.status.replaceAll('_', ' ')}
          </Badge>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
      <p className="text-xs text-muted-foreground">
        {comment.pagePath}
        {comment.sectionId ? ` · ${comment.sectionId}` : ''}
      </p>
      {comment.trace.interpretation ? (
        <div className="rounded border bg-muted/40 p-2 text-xs">
          <p className="font-medium">How SiteForge interpreted this</p>
          <p className="mt-1 whitespace-pre-wrap">
            {comment.trace.interpretation}
          </p>
          {comment.trace.semanticOperations.length ? (
            <ul className="mt-2 space-y-1">
              {comment.trace.semanticOperations.map((operation, index) => (
                <li key={`${operation.operation}-${operation.target}-${index}`}>
                  {operation.operation} → {operation.target}
                  {operation.summary ? ` — ${operation.summary}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {comment.trace.resultingArtifactId ? (
            <p className="mt-2">
              Resulting revision {comment.trace.resultingArtifactId} ·{' '}
              {comment.trace.verificationStatus}
            </p>
          ) : null}
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onReply(comment)}
      >
        Reply
      </Button>
      {replies.length ? (
        <div className="ml-4 space-y-2 border-l pl-3">
          {replies.map(reply => (
            <div key={reply.id} className="rounded bg-muted/40 p-2 text-sm">
              <p className="text-xs font-medium">{reply.authorName}</p>
              <p className="mt-1 whitespace-pre-wrap">{reply.body}</p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function SiteForgeClientReview({
  initialReview,
}: {
  initialReview: PublicReviewData
}) {
  const [review, setReview] = useState(initialReview)
  const [pageSlug, setPageSlug] = useState(
    initialReview.preview.pages[0]?.slug || ''
  )
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [commentBody, setCommentBody] = useState('')
  const [category, setCategory] = useState('general')
  const [replyTo, setReplyTo] = useState<PublicReviewComment | null>(null)
  const [decision, setDecision] =
    useState<ReviewDecision>('approved_with_notes')
  const [rationale, setRationale] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPage =
    review.preview.pages.find(page => page.slug === pageSlug) ||
    review.preview.pages[0]
  const commentsForPage = useMemo(
    () =>
      review.comments.filter(
        comment =>
          comment.pagePath === `/${pageSlug}` ||
          (pageSlug === 'home' && comment.pagePath === '/')
      ),
    [pageSlug, review.comments]
  )
  const rootComments = commentsForPage.filter(
    comment => !comment.parentCommentId
  )
  const canComment =
    review.artifact.isCurrent &&
    review.permissions.includes('comment') &&
    ['open', 'changes_requested'].includes(review.session.status)
  const canDecide =
    review.artifact.isCurrent &&
    review.canonicalRelease?.exact === true &&
    review.permissions.includes('decide') &&
    ['open', 'changes_requested'].includes(review.session.status)

  async function refreshReview() {
    const response = await fetch('/api/siteforge/reviews/public', {
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || 'Review could not be refreshed')
    }
    setReview(data as PublicReviewData)
  }

  async function submitComment() {
    if (!selectedPage || !commentBody.trim() || !canComment || pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        '/api/siteforge/reviews/public/comments',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pagePath: `/${selectedPage.slug}`,
            sectionId,
            parentCommentId: replyTo?.id || null,
            viewport,
            category,
            body: commentBody.trim(),
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Comment was not saved')
      setCommentBody('')
      setReplyTo(null)
      await refreshReview()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Comment was not saved')
    } finally {
      setPending(false)
    }
  }

  async function submitDecision() {
    if (!rationale.trim() || !canDecide || pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        '/api/siteforge/reviews/public/decisions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            decision,
            rationale: rationale.trim(),
            artifactId: review.artifact.id,
            contentHash: review.artifact.contentHash,
            certificationId: review.canonicalRelease?.certificationId,
            canonicalUrl: review.canonicalRelease?.url,
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Decision was not saved')
      setRationale('')
      await refreshReview()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Decision was not saved')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{review.session.title}</CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  Website revision {review.artifact.version}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={review.artifact.isCurrent ? 'success' : 'outline'}>
                  {review.artifact.isCurrent ? 'Current revision' : 'Read-only revision'}
                </Badge>
                <Badge variant="outline">
                  Client review · separate from deployment approval
                </Badge>
              </div>
            </div>
            {review.session.instructions ? (
              <p className="text-sm">{review.session.instructions}</p>
            ) : null}
            {review.notice ? (
              <p
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
              >
                {review.notice}
              </p>
            ) : null}
            {review.canonicalRelease?.exact ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
                <p className="font-medium">
                  Certified canonical WordPress artifact
                </p>
                <p className="mt-1 break-all font-mono text-xs">
                  {review.canonicalRelease.artifactId} ·{' '}
                  {review.canonicalRelease.contentHash}
                </p>
                <p className="mt-1 text-xs">
                  Certification {review.canonicalRelease.certificationId} ·{' '}
                  {review.canonicalRelease.certificationPolicy} ·{' '}
                  {new Date(
                    review.canonicalRelease.certifiedAt
                  ).toLocaleString()}
                </p>
                <a
                  className="mt-1 inline-block break-all underline"
                  href={review.canonicalRelease.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {review.canonicalRelease.url}
                </a>
              </div>
            ) : (
              <p
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
              >
                Final visual approval is unavailable until this exact artifact
                has a passed canonical WordPress certification.
              </p>
            )}
          </CardHeader>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="min-w-0 overflow-hidden">
            {review.canonicalRelease?.exact ? (
              <div className="border-b bg-background p-3">
                <p className="mb-2 text-sm font-medium">
                  Final visual approval surface · certified WordPress
                </p>
                <iframe
                  title="Certified canonical WordPress artifact"
                  src={review.canonicalRelease.url}
                  className="h-[720px] w-full rounded border bg-white"
                  referrerPolicy="no-referrer"
                  sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
                />
              </div>
            ) : null}
            <CardHeader className="border-b">
              <p className="text-sm font-medium">
                Content-only reference renderer
              </p>
              <p className="text-xs text-muted-foreground">
                Sanitized copy and structure only. This renderer is not the
                canonical WordPress visual artifact and cannot be finally
                approved.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {review.preview.pages.map(page => (
                    <Button
                      key={page.slug}
                      size="sm"
                      variant={selectedPage?.slug === page.slug ? 'default' : 'outline'}
                      onClick={() => {
                        setPageSlug(page.slug)
                        setSectionId(null)
                      }}
                    >
                      {page.title}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2" aria-label="Preview viewport">
                  {(['mobile', 'tablet', 'desktop'] as const).map(option => (
                    <Button
                      key={option}
                      size="sm"
                      variant={viewport === option ? 'default' : 'outline'}
                      onClick={() => setViewport(option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-auto bg-muted/40 p-3">
              <div
                className="mx-auto min-h-[720px] bg-white transition-[width]"
                style={{ width: VIEWPORT_WIDTH[viewport] }}
              >
                {selectedPage?.sections.map(section => (
                  <section
                    key={section.id}
                    className={`group relative ${
                      sectionId === section.id
                        ? 'ring-4 ring-inset ring-primary'
                        : 'hover:ring-2 hover:ring-inset hover:ring-primary/40'
                    }`}
                  >
                    {canComment ? (
                      <button
                        type="button"
                        className="absolute right-3 top-3 z-10 rounded-md border bg-background/95 px-3 py-1.5 text-xs font-medium opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
                        aria-pressed={sectionId === section.id}
                        onClick={() =>
                          setSectionId(current =>
                            current === section.id ? null : section.id
                          )
                        }
                      >
                        {sectionId === section.id
                          ? 'Commenting here'
                          : 'Comment on section'}
                      </button>
                    ) : null}
                    <ACFBlockRenderer
                      blockType={section.acfBlock}
                      blockIdentity={`${selectedPage.slug}:${section.id}`}
                      content={section.content}
                      className={(section.cssClasses || []).join(' ')}
                      variant={section.variant}
                      designSystem={
                        review.preview.designSystem as DesignSystem | undefined
                      }
                    />
                  </section>
                ))}
                {!selectedPage ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    No client-safe preview is available for this revision.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {canComment ? (
                  <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                    <div>
                      <Label htmlFor="review-category">Category</Label>
                      <Select
                        id="review-category"
                        className="mt-1"
                        value={category}
                        onValueChange={setCategory}
                      >
                        {[
                          'general',
                          'brand',
                          'copy',
                          'layout',
                          'image',
                          'conversion',
                          'legal',
                          'accessibility',
                          'seo',
                          'bug',
                        ].map(option => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="review-comment">
                        {replyTo
                          ? `Reply to ${replyTo.authorName}`
                          : sectionId
                            ? `Comment on ${sectionId}`
                            : 'Page comment'}
                      </Label>
                      <Textarea
                        id="review-comment"
                        className="mt-1 min-h-28"
                        value={commentBody}
                        onChange={event => setCommentBody(event.target.value)}
                        placeholder="Describe the requested change and why it matters…"
                        disabled={pending}
                      />
                    </div>
                    <div className="flex justify-between gap-2">
                      {replyTo || sectionId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setReplyTo(null)
                            setSectionId(null)
                          }}
                        >
                          Clear scope
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void submitComment()}
                        disabled={pending || !commentBody.trim()}
                      >
                        {pending ? 'Saving…' : 'Add comment'}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {rootComments.length ? (
                  rootComments.map(comment => (
                    <CommentCard
                      key={comment.id}
                      comment={comment}
                      replies={commentsForPage.filter(
                        reply => reply.parentCommentId === comment.id
                      )}
                      onReply={item => {
                        setReplyTo(item)
                        setSectionId(item.sectionId)
                      }}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No comments on this page yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {review.clientApproval ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <Badge
                      variant={
                        review.clientApproval.validForCurrentArtifact
                          ? 'success'
                          : 'outline'
                      }
                    >
                      {review.clientApproval.decision.replaceAll('_', ' ')}
                    </Badge>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {review.clientApproval.validForCurrentArtifact
                        ? 'Valid for this exact client-review revision.'
                        : 'Not valid for the current website revision.'}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap">
                      {review.clientApproval.rationale}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs">
                      {review.clientApproval.artifactId} ·{' '}
                      {review.clientApproval.contentHash}
                    </p>
                    <p className="mt-1 break-all text-xs">
                      Certification {review.clientApproval.certificationId} ·{' '}
                      {review.clientApproval.canonicalUrl}
                    </p>
                  </div>
                ) : null}
                {canDecide ? (
                  <>
                    <div>
                      <Label htmlFor="client-decision">Decision</Label>
                      <Select
                        id="client-decision"
                        className="mt-1"
                        value={decision}
                        onValueChange={value =>
                          setDecision(value as ReviewDecision)
                        }
                      >
                        <SelectItem value="approved">Approve</SelectItem>
                        <SelectItem value="approved_with_notes">
                          Approve with notes
                        </SelectItem>
                        <SelectItem value="changes_requested">
                          Request changes
                        </SelectItem>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="client-rationale">
                        Decision rationale
                      </Label>
                      <Textarea
                        id="client-rationale"
                        className="mt-1 min-h-28"
                        value={rationale}
                        onChange={event => setRationale(event.target.value)}
                        placeholder="Explain the decision and any remaining notes…"
                        disabled={pending}
                      />
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => void submitDecision()}
                      disabled={pending || !rationale.trim()}
                    >
                      {pending ? 'Recording…' : 'Record client decision'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Client approval does not authorize staging or production
                      deployment. Internal deployment approval remains separate.
                    </p>
                  </>
                ) : null}
                {!canDecide ? (
                  <p className="text-xs text-muted-foreground">
                    Decisions require the current artifact and its exact passed
                    canonical WordPress certification.
                  </p>
                ) : null}
                {review.decisions.map(item => (
                  <details key={item.id} className="rounded border p-2 text-sm">
                    <summary className="cursor-pointer">
                      {item.decision.replaceAll('_', ' ')} ·{' '}
                      {new Date(item.createdAt).toLocaleString()}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap">{item.rationale}</p>
                    <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                      {item.artifactId} · {item.contentHash}
                    </p>
                  </details>
                ))}
              </CardContent>
            </Card>

            {review.rounds.length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Revision rounds</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {review.rounds.map(round => (
                    <div key={round.id} className="rounded border p-3 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">
                          Round {round.number}
                        </span>
                        <Badge variant={statusVariant(round.status)}>
                          {round.status.replaceAll('_', ' ')}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {round.disposition.open} open ·{' '}
                        {round.disposition.accepted} accepted ·{' '}
                        {round.disposition.rejected} declined ·{' '}
                        {round.disposition.verified} verified
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  )
}
