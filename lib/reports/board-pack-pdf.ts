import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { BoardPackData } from './board-pack-data'

function formatMoney(amount: number, locale: string, currency: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }
}

function formatDate(value: Date | string, locale: string): string {
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return '—'
  try {
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
}

export async function generateBoardPackPdf(data: BoardPackData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([612, 792])
  const { height } = page.getSize()
  const margin = 50
  let y = height - margin

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const { locale, currency } = data
  const money = (n: number) => formatMoney(n, locale, currency)

  const addLine = (
    text: string,
    opts: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const size = opts.size ?? 11
    const font = opts.font ?? regular
    const color = opts.color ?? rgb(0, 0, 0)
    if (y < margin + 40) {
      page = pdfDoc.addPage([612, 792])
      y = height - margin
    }
    page.drawText(text, { x: margin, y, size, font, color, maxWidth: page.getWidth() - margin * 2 })
    y -= size + 6
  }

  const addSection = (title: string) => {
    y -= 8
    addLine(title, { size: 13, font: bold })
    y -= 2
  }

  addLine('Board Pack', { size: 20, font: bold })
  addLine(`${data.orgName} · ${data.year}`, { size: 12, color: rgb(0.35, 0.35, 0.35) })
  y -= 10

  addSection('P&L Summary')
  addLine(`Total income: ${money(data.pl.totalIncome)}`)
  addLine(`Total expenses: ${money(data.pl.totalExpenses)}`)
  addLine(`Net profit/loss: ${money(data.pl.netProfit)}`)
  addLine(`Transactions: ${data.pl.transactionCount}`)

  addSection(`Top delinquent families (${data.delinquentFamilies.length})`)
  if (data.delinquentFamilies.length === 0) {
    addLine('No families with outstanding balances.', { color: rgb(0.4, 0.4, 0.4) })
  } else {
    for (const row of data.delinquentFamilies) {
      const overdue = row.daysOverdue != null ? ` · ${row.daysOverdue}d overdue` : ''
      addLine(`${row.familyName}: ${money(row.amountOwed)} owed${overdue}`)
    }
  }

  addSection(`Upcoming lifecycle events (${data.upcomingEvents.length})`)
  if (data.upcomingEvents.length === 0) {
    addLine('No upcoming events in the next 60 days.', { color: rgb(0.4, 0.4, 0.4) })
  } else {
    for (const ev of data.upcomingEvents) {
      addLine(
        `${formatDate(ev.eventDate, locale)} · ${ev.familyName} · ${ev.eventTypeLabel} · ${money(ev.amount)}`,
      )
    }
  }

  addLine(`Generated ${new Date().toLocaleString(locale)}`, { size: 9, color: rgb(0.5, 0.5, 0.5) })

  const bytes = await pdfDoc.save()
  return Buffer.from(bytes)
}
