import { NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { recordEmailOpen, trackingPixelDataUri } from '@/lib/mail'
import { handler } from '@/lib/api/handler'

const GIF = Buffer.from(trackingPixelDataUri().split(',')[1]!, 'base64')

export const GET = handler({
  auth: 'public',
  noDb: false,
  name: 'GET /api/email/track/open/[id]',
  fn: async ({ params }) => {
    const id = String(params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      return new NextResponse(GIF, {
        status: 404,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
      })
    }

    await recordEmailOpen(id)

    return new NextResponse(GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  },
})
