import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { decodeClickTarget, recordEmailClick } from '@/lib/mail'
import { handler } from '@/lib/api/handler'

export const GET = handler({
  auth: 'public',
  name: 'GET /api/email/track/click/[id]',
  query: undefined,
  fn: async ({ params, request }) => {
    const id = String(params.id ?? '')
    const encoded = new URL(request.url).searchParams.get('u') ?? ''
    const target = decodeClickTarget(encoded)

    if (!Types.ObjectId.isValid(id) || !target) {
      return NextResponse.redirect(new URL('/', request.url), 302)
    }

    await recordEmailClick(id, target)
    return NextResponse.redirect(target, 302)
  },
})
