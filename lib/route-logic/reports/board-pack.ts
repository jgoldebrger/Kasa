import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { yearParam } from '@/lib/schemas'
import { loadBoardPackData } from '@/lib/reports/board-pack-data'
import { generateBoardPackPdf } from '@/lib/reports/board-pack-pdf'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/reports/board-pack',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-board-pack',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const yearStr = request.nextUrl.searchParams.get('year')
    const yearParsed = yearParam.safeParse(yearStr ?? String(new Date().getFullYear()))
    if (!yearParsed.success) {
      return { status: 400, data: { error: 'Invalid or missing year' } }
    }

    const data = await loadBoardPackData(ctx!.organizationId, yearParsed.data)
    const pdfBuffer = await generateBoardPackPdf(data)
    const safeOrg = data.orgName.replace(/[^a-z0-9_\-]+/gi, '_')

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Board_Pack_${safeOrg}_${data.year}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  },
})
