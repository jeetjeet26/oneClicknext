import Link from 'next/link'

export default async function BookTourPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Tour Request</h1>
        <p className="mt-3 text-sm text-gray-600">
          We received your tour request reference <span className="font-mono">{leadId}</span>.
        </p>
        <p className="mt-3 text-sm text-gray-600">
          Please use the assistant widget to book your time, or contact the leasing team directly for immediate help.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Go to Site
          </Link>
          <Link
            href="/dashboard/leads"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Open Dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
