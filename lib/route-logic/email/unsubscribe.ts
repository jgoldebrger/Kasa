import { NextResponse } from 'next/server'
import { Family } from '@/lib/models'
import { verifyUnsubscribeToken } from '@/lib/mail/unsubscribe-token'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'public',
  name: 'GET /api/email/unsubscribe',
  fn: async ({ request }) => {
    const token = new URL(request.url).searchParams.get('token')?.trim()
    if (!token) {
      return { status: 400, data: { error: 'Missing unsubscribe token' } }
    }

    const parsed = verifyUnsubscribeToken(token)
    if (!parsed) {
      return { status: 400, data: { error: 'Invalid or expired unsubscribe link' } }
    }

    const updated = await Family.findOneAndUpdate(
      { _id: parsed.familyId, organizationId: parsed.organizationId },
      { $set: { emailOptOut: true } },
      { new: true },
    ).select('name emailOptOut')

    if (!updated) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family:Arial,sans-serif;padding:40px;text-align:center;">
  <h1>You have been unsubscribed</h1>
  <p>You will no longer receive bulk emails from this organization.</p>
</body></html>`

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
})
