import { NextResponse } from 'next/server'
import { Family, Organization } from '@/lib/models'
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
      { $set: { communicationsOptOut: true } },
      { new: true },
    ).select('name communicationsOptOut')

    if (!updated) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    const org = await Organization.findById(parsed.organizationId).select('name').lean<{
      name?: string
    }>()
    const orgName = org?.name?.trim() || 'this organization'
    const familyName = updated.name?.trim() || 'your household'

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed — ${escapeHtml(orgName)}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1f2937;background:#f9fafb;margin:0;padding:40px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:32px 28px;">
    <h1 style="margin:0 0 12px;font-size:22px;color:#111827;">You&rsquo;re unsubscribed</h1>
    <p style="margin:0 0 16px;font-size:15px;">
      <strong>${escapeHtml(familyName)}</strong> will no longer receive bulk emails and newsletters from
      <strong>${escapeHtml(orgName)}</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#4b5563;">
      You may still receive important account messages such as statements or receipts when your organization sends them individually.
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">
      If this was a mistake, contact ${escapeHtml(orgName)} to re-subscribe.
    </p>
  </div>
</body>
</html>`

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
