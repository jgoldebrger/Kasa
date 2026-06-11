import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export interface StatementTransaction {
  type: 'payment' | 'withdrawal' | 'event' | 'cycle-charge'
  date: Date | string
  description: string
  amount: number
  notes?: string
}

export interface StatementOrg {
  name?: string
  // BCP 47 locale + ISO 4217 currency for amounts/dates on the PDF.
  // Both optional; the generator falls back to en-US / USD when absent.
  locale?: string
  currency?: string
  letterhead?: {
    addressLine1?: string
    addressLine2?: string
    city?: string
    state?: string
    zip?: string
    phone?: string
    email?: string
    statementFooter?: string
  } | null
}

export async function generateStatementPDF(
  statement: any,
  familyName: string,
  transactions: StatementTransaction[],
  org?: StatementOrg | null,
): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.create()
    let page = pdfDoc.addPage([612, 792]) // US Letter size
    const { width, height } = page.getSize()
    
    const margin = 50
    const maxWidth = width - 2 * margin
    let yPosition = height - margin

    // Load fonts
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    // Use the org's configured locale / currency when present. Fall
    // back to en-US/USD so existing orgs that haven't touched the
    // Localization settings render exactly as before.
    const docLocale = (org as any)?.locale || 'en-US'
    const docCurrency = (org as any)?.currency || 'USD'

    const formatDate = (date: Date | string) => {
      const d = new Date(date)
      if (!Number.isFinite(d.getTime())) return '—'
      try {
        return d.toLocaleDateString(docLocale, { year: 'numeric', month: 'long', day: 'numeric' })
      } catch {
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      }
    }

    const formatCurrency = (amount: number) => {
      try {
        return new Intl.NumberFormat(docLocale, {
          style: 'currency',
          currency: docCurrency,
        }).format(amount)
      } catch {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(amount)
      }
    }

    // Helper function to add text with word wrapping
    const addText = (text: string, x: number, options: {
      font?: any
      size?: number
      color?: any
      maxWidth?: number
      align?: 'left' | 'center' | 'right'
    } = {}) => {
      const {
        font = helveticaFont,
        size = 10,
        color = rgb(0, 0, 0),
        maxWidth: textMaxWidth = maxWidth,
        align = 'left'
      } = options

      let textWidth = font.widthOfTextAtSize(text, size)
      let displayText = text

      // Handle text wrapping
      if (textWidth > textMaxWidth && textMaxWidth > 0) {
        const words = text.split(' ')
        let line = ''
        let lines: string[] = []
        
        for (const word of words) {
          const testLine = line + (line ? ' ' : '') + word
          const testWidth = font.widthOfTextAtSize(testLine, size)
          
          if (testWidth > textMaxWidth && line) {
            lines.push(line)
            line = word
          } else {
            line = testLine
          }
        }
        if (line) lines.push(line)
        displayText = lines.join('\n')
      }

      // Calculate x position for alignment
      let xPos = x
      if (align === 'center') {
        textWidth = font.widthOfTextAtSize(displayText.split('\n')[0] || displayText, size)
        xPos = x + (textMaxWidth - textWidth) / 2
      } else if (align === 'right') {
        textWidth = font.widthOfTextAtSize(displayText.split('\n')[0] || displayText, size)
        xPos = x + textMaxWidth - textWidth
      }

      page.drawText(displayText, {
        x: xPos,
        y: yPosition,
        size,
        font,
        color,
        maxWidth: textMaxWidth > 0 ? textMaxWidth : undefined
      })

      // Return the height used (approximate)
      const lines = displayText.split('\n').length
      const heightUsed = lines * size * 1.2
      yPosition -= heightUsed
      return heightUsed
    }

    // Header — org name from letterhead config, falls back to product name
    const orgName = (org?.name || '').trim() || 'Kasa Family Management'
    const lh = org?.letterhead || {}
    addText(orgName, margin, {
      font: helveticaBoldFont,
      size: 24,
      color: rgb(0.31, 0.27, 0.90), // #4F46E5
      align: 'center',
      maxWidth: maxWidth
    })

    // Optional letterhead address/contact block (centered, small, gray).
    const cityStateZip = [
      [lh.city, lh.state].filter(Boolean).join(', '),
      lh.zip,
    ]
      .filter(Boolean)
      .join(' ')
    const letterheadLines = [
      lh.addressLine1,
      lh.addressLine2,
      cityStateZip,
      [lh.phone, lh.email].filter(Boolean).join('  •  '),
    ].filter(Boolean) as string[]
    for (const line of letterheadLines) {
      addText(line, margin, {
        size: 9,
        color: rgb(0.42, 0.45, 0.5),
        align: 'center',
        maxWidth: maxWidth,
      })
      yPosition -= 2
    }

    addText('Monthly Statement', margin, {
      size: 14,
      color: rgb(0.4, 0.4, 0.4),
      align: 'center',
      maxWidth: maxWidth
    })
    
    yPosition -= 20

    // Statement Info
    addText(`Family: ${familyName}`, margin, { size: 10 })
    yPosition -= 5
    addText(`Statement Number: ${statement.statementNumber}`, margin, { size: 10 })
    yPosition -= 5
    addText(`Statement Date: ${formatDate(statement.date)}`, margin, { size: 10 })
    yPosition -= 5
    addText(`Period: ${formatDate(statement.fromDate)} - ${formatDate(statement.toDate)}`, margin, { size: 10 })
    yPosition -= 20

    // Summary Section
    addText('Summary', margin, {
      font: helveticaBoldFont,
      size: 14,
      color: rgb(0.31, 0.27, 0.90)
    })
    yPosition -= 10

    const summaryLeft = margin
    const summaryRight = margin + 200

    const balanceY = yPosition
    addText('Opening Balance:', summaryLeft, { size: 10 })
    yPosition = balanceY
    addText(formatCurrency(statement.openingBalance), summaryRight, { size: 10, align: 'right', maxWidth: 100 })
    yPosition = balanceY - 20

    const incomeY = yPosition
    addText('Income:', summaryLeft, { size: 10, color: rgb(0.06, 0.73, 0.51) }) // #10b981
    yPosition = incomeY
    addText(formatCurrency(statement.income), summaryRight, { size: 10, color: rgb(0.06, 0.73, 0.51), align: 'right', maxWidth: 100 })
    yPosition = incomeY - 20

    const withdrawalsY = yPosition
    addText('Withdrawals:', summaryLeft, { size: 10, color: rgb(0.94, 0.27, 0.27) }) // #ef4444
    yPosition = withdrawalsY
    addText(formatCurrency(statement.withdrawals), summaryRight, { size: 10, color: rgb(0.94, 0.27, 0.27), align: 'right', maxWidth: 100 })
    yPosition = withdrawalsY - 20

    if ((statement.cycleCharges || 0) > 0) {
      const cycleY = yPosition
      addText('Annual Dues Charged:', summaryLeft, { size: 10, color: rgb(0.94, 0.27, 0.27) })
      yPosition = cycleY
      addText(
        formatCurrency(statement.cycleCharges || 0),
        summaryRight,
        { size: 10, color: rgb(0.94, 0.27, 0.27), align: 'right', maxWidth: 100 },
      )
      yPosition = cycleY - 20
    }

    const expensesY = yPosition
    addText('Expenses:', summaryLeft, { size: 10, color: rgb(0.94, 0.27, 0.27) })
    yPosition = expensesY
    addText(formatCurrency(statement.expenses), summaryRight, { size: 10, color: rgb(0.94, 0.27, 0.27), align: 'right', maxWidth: 100 })
    yPosition = expensesY - 20

    const closingY = yPosition
    addText('Closing Balance:', summaryLeft, { font: helveticaBoldFont, size: 12 })
    yPosition = closingY
    addText(formatCurrency(statement.closingBalance), summaryRight, { font: helveticaBoldFont, size: 12, align: 'right', maxWidth: 100 })
    yPosition = closingY - 30

    // Transactions Section
    if (transactions.length > 0) {
      // Check if we need a new page
      if (yPosition < 200) {
        page = pdfDoc.addPage([612, 792])
        yPosition = height - margin
      }

      addText('Transaction Details', margin, {
        font: helveticaBoldFont,
        size: 14,
        color: rgb(0.31, 0.27, 0.90)
      })
      yPosition -= 10

      // Table headers
      const tableTop = yPosition
      const tableLeft = margin
      const dateWidth = 80
      const descWidth = 200
      const amountWidth = 100
      const notesWidth = 100

      addText('Date', tableLeft, { font: helveticaBoldFont, size: 9, maxWidth: dateWidth })
      yPosition = tableTop
      addText('Description', tableLeft + dateWidth, { font: helveticaBoldFont, size: 9, maxWidth: descWidth })
      yPosition = tableTop
      addText('Amount', tableLeft + dateWidth + descWidth, { font: helveticaBoldFont, size: 9, maxWidth: amountWidth })
      yPosition = tableTop
      addText('Notes', tableLeft + dateWidth + descWidth + amountWidth, { font: helveticaBoldFont, size: 9, maxWidth: notesWidth })

      // Draw line under headers
      yPosition = tableTop - 15
      page.drawLine({
        start: { x: tableLeft, y: yPosition },
        end: { x: tableLeft + dateWidth + descWidth + amountWidth + notesWidth, y: yPosition },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8)
      })

      yPosition -= 10

      transactions.forEach((transaction) => {
        // Check if we need a new page
        if (yPosition < 100) {
          page = pdfDoc.addPage([612, 792])
          yPosition = height - margin
        }

        const rowY = yPosition
        addText(formatDate(transaction.date), tableLeft, { size: 9, maxWidth: dateWidth })
        
        const desc = transaction.description.length > 30 
          ? transaction.description.substring(0, 27) + '...' 
          : transaction.description
        yPosition = rowY
        addText(desc, tableLeft + dateWidth, { size: 9, maxWidth: descWidth })
        
        const amountText = `${transaction.amount >= 0 ? '+' : ''}${formatCurrency(transaction.amount)}`
        const amountColor = transaction.amount >= 0 
          ? rgb(0.06, 0.73, 0.51) 
          : rgb(0.94, 0.27, 0.27)
        yPosition = rowY
        addText(amountText, tableLeft + dateWidth + descWidth, { 
          size: 9, 
          color: amountColor, 
          maxWidth: amountWidth 
        })
        
        const notes = (transaction.notes || '-').length > 20
          ? (transaction.notes || '-').substring(0, 17) + '...'
          : (transaction.notes || '-')
        yPosition = rowY
        addText(notes, tableLeft + dateWidth + descWidth + amountWidth, { size: 9, maxWidth: notesWidth })

        yPosition = rowY - 20
      })

      yPosition -= 10
    }

    // Footer — custom statementFooter if configured, otherwise a sensible default
    yPosition -= 30
    const customFooter = (lh.statementFooter || '').trim()
    if (customFooter) {
      for (const line of customFooter.split(/\r?\n/)) {
        addText(line, margin, {
          size: 8,
          color: rgb(0.42, 0.45, 0.50),
          align: 'center',
          maxWidth: maxWidth,
        })
      }
    } else {
      addText(`This is an automated statement from ${orgName}.`, margin, {
        size: 8,
        color: rgb(0.42, 0.45, 0.50),
        align: 'center',
        maxWidth: maxWidth
      })
      addText('If you have any questions, please contact us.', margin, {
        size: 8,
        color: rgb(0.42, 0.45, 0.50),
        align: 'center',
        maxWidth: maxWidth
      })
    }

    const pdfBytes = await pdfDoc.save()
    return Buffer.from(pdfBytes)
  } catch (error) {
    console.error('Error generating PDF:', error)
    throw error
  }
}

export interface TaxReceiptPayment {
  date: Date | string
  method: string
  amount: number
  notes?: string
}

export interface TaxReceiptOrg {
  name: string
  // Org-configured BCP 47 locale and ISO 4217 currency. Optional so
  // pre-existing callers keep rendering as USD/en-US; pass them in to
  // get a properly localized receipt (e.g. ₪ for Israeli orgs).
  locale?: string
  currency?: string
  letterhead?: {
    addressLine1?: string
    addressLine2?: string
    city?: string
    state?: string
    zip?: string
    phone?: string
    email?: string
    taxId?: string
    signatureName?: string
    signatureTitle?: string
    receiptThankYou?: string
    taxDeductibleDisclosure?: string
  } | null
}

export interface TaxReceiptFamily {
  name: string
  street?: string
  city?: string
  state?: string
  zip?: string
}

/**
 * Year-end annual donation receipt.
 *
 * Renders a single-page US Letter PDF. Skips letterhead lines that
 * are empty so a half-populated letterhead still produces a clean
 * document; falls back to just the org name when no letterhead is
 * configured at all.
 *
 * The caller is responsible for filtering out families whose
 * `totalPaid` is 0 — this function will happily render an empty
 * payments table if asked.
 */
export async function generateTaxReceiptPDF(
  org: TaxReceiptOrg,
  family: TaxReceiptFamily,
  payments: TaxReceiptPayment[],
  year: number,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([612, 792])
  const { width, height } = page.getSize()
  const margin = 50
  const maxWidth = width - 2 * margin
  let yPosition = height - margin

  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const docLocale = org.locale || 'en-US'
  const docCurrency = (org.currency || 'USD').toUpperCase()

  const formatDate = (date: Date | string) => {
    const d = new Date(date)
    if (!Number.isFinite(d.getTime())) return '—'
    try {
      return d.toLocaleDateString(docLocale, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    }
  }
  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat(docLocale, { style: 'currency', currency: docCurrency }).format(
        amount,
      )
    } catch {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
    }
  }

  // Tiny local text helper modeled on `generateStatementPDF`'s
  // `addText`, but pared down — receipts never wrap because every
  // line is a short address / name / amount.
  const draw = (
    text: string,
    x: number,
    opts: {
      font?: any
      size?: number
      color?: any
      align?: 'left' | 'right' | 'center'
      maxW?: number
    } = {},
  ) => {
    if (!text) return 0
    const { font = helveticaFont, size = 10, color = rgb(0, 0, 0), align = 'left', maxW = maxWidth } = opts
    const w = font.widthOfTextAtSize(text, size)
    let xPos = x
    if (align === 'center') xPos = x + (maxW - w) / 2
    else if (align === 'right') xPos = x + maxW - w
    page.drawText(text, { x: xPos, y: yPosition, size, font, color })
    const used = size * 1.4
    yPosition -= used
    return used
  }

  const skipLine = (h = 6) => {
    yPosition -= h
  }

  // ---------------- Header (left: org letterhead, right: receipt title) ----------------
  const lh = org.letterhead || {}
  const headerTopY = yPosition

  // Left: org block
  draw(org.name || '', margin, { font: helveticaBoldFont, size: 18, color: rgb(0.31, 0.27, 0.90) })
  if (lh.addressLine1) draw(lh.addressLine1, margin, { size: 10, color: rgb(0.35, 0.35, 0.4) })
  if (lh.addressLine2) draw(lh.addressLine2, margin, { size: 10, color: rgb(0.35, 0.35, 0.4) })
  const cityStateZip = [
    [lh.city, lh.state].filter(Boolean).join(', '),
    lh.zip,
  ]
    .filter(Boolean)
    .join(' ')
  if (cityStateZip) draw(cityStateZip, margin, { size: 10, color: rgb(0.35, 0.35, 0.4) })
  const contactPieces = [lh.phone, lh.email].filter(Boolean)
  if (contactPieces.length > 0) draw(contactPieces.join('  •  '), margin, { size: 10, color: rgb(0.35, 0.35, 0.4) })
  if (lh.taxId) draw(`EIN: ${lh.taxId}`, margin, { size: 10, color: rgb(0.35, 0.35, 0.4) })

  // Right: receipt title (drawn at the captured header Y, independently
  // of the left column so address lines don't push the title down).
  const leftEndY = yPosition
  yPosition = headerTopY
  draw('Annual Donation Receipt', margin, {
    font: helveticaBoldFont,
    size: 14,
    color: rgb(0.31, 0.27, 0.90),
    align: 'right',
  })
  draw(`Tax Year ${year}`, margin, { size: 11, color: rgb(0.35, 0.35, 0.4), align: 'right' })

  // Move below whichever block was taller.
  yPosition = Math.min(leftEndY, yPosition) - 10

  // Divider rule.
  page.drawLine({
    start: { x: margin, y: yPosition },
    end: { x: margin + maxWidth, y: yPosition },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.9),
  })
  yPosition -= 20

  // ---------------- Recipient ----------------
  draw('Donor', margin, { font: helveticaBoldFont, size: 10, color: rgb(0.42, 0.45, 0.5) })
  draw(family.name || '', margin, { font: helveticaBoldFont, size: 12 })
  if (family.street) draw(family.street, margin, { size: 10, color: rgb(0.35, 0.35, 0.4) })
  const famCityStateZip = [
    [family.city, family.state].filter(Boolean).join(', '),
    family.zip,
  ]
    .filter(Boolean)
    .join(' ')
  if (famCityStateZip) draw(famCityStateZip, margin, { size: 10, color: rgb(0.35, 0.35, 0.4) })
  yPosition -= 16

  // Thank-you (optional).
  if (lh.receiptThankYou) {
    draw(lh.receiptThankYou, margin, { size: 10, color: rgb(0.2, 0.2, 0.2) })
    yPosition -= 8
  }

  // ---------------- Payments table ----------------
  draw('Contributions', margin, { font: helveticaBoldFont, size: 12, color: rgb(0.31, 0.27, 0.90) })
  yPosition -= 6
  const tableLeft = margin
  const dateCol = tableLeft
  const methodCol = tableLeft + 110
  const amountCol = tableLeft + maxWidth - 100
  const notesCol = tableLeft + 200

  // Header row.
  const headerRowY = yPosition
  page.drawText('Date', { x: dateCol, y: headerRowY, size: 9, font: helveticaBoldFont, color: rgb(0.35, 0.35, 0.4) })
  page.drawText('Method', { x: methodCol, y: headerRowY, size: 9, font: helveticaBoldFont, color: rgb(0.35, 0.35, 0.4) })
  page.drawText('Notes', { x: notesCol, y: headerRowY, size: 9, font: helveticaBoldFont, color: rgb(0.35, 0.35, 0.4) })
  const amountHeaderW = helveticaBoldFont.widthOfTextAtSize('Amount', 9)
  page.drawText('Amount', { x: amountCol + 100 - amountHeaderW, y: headerRowY, size: 9, font: helveticaBoldFont, color: rgb(0.35, 0.35, 0.4) })
  yPosition -= 12
  page.drawLine({
    start: { x: tableLeft, y: yPosition },
    end: { x: tableLeft + maxWidth, y: yPosition },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.85),
  })
  yPosition -= 12

  let runningTotal = 0
  const truncate = (s: string, max: number) => (s.length > max ? s.substring(0, max - 1) + '…' : s)
  for (const p of payments) {
    if (yPosition < 130) {
      page = pdfDoc.addPage([612, 792])
      yPosition = height - margin
    }
    const rowY = yPosition
    runningTotal += Number(p.amount || 0)
    page.drawText(formatDate(p.date), { x: dateCol, y: rowY, size: 9, font: helveticaFont, color: rgb(0, 0, 0) })
    page.drawText(truncate(String(p.method || ''), 18), { x: methodCol, y: rowY, size: 9, font: helveticaFont, color: rgb(0, 0, 0) })
    page.drawText(truncate(String(p.notes || ''), 30), { x: notesCol, y: rowY, size: 9, font: helveticaFont, color: rgb(0.35, 0.35, 0.4) })
    const amtText = formatCurrency(Number(p.amount || 0))
    const amtW = helveticaFont.widthOfTextAtSize(amtText, 9)
    page.drawText(amtText, { x: amountCol + 100 - amtW, y: rowY, size: 9, font: helveticaFont, color: rgb(0, 0, 0) })
    yPosition -= 16
  }

  // Total row.
  yPosition -= 4
  page.drawLine({
    start: { x: tableLeft, y: yPosition },
    end: { x: tableLeft + maxWidth, y: yPosition },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.85),
  })
  yPosition -= 16
  const totalLabel = 'Total contributions'
  page.drawText(totalLabel, {
    x: amountCol - helveticaBoldFont.widthOfTextAtSize(totalLabel, 11) + 100 - helveticaBoldFont.widthOfTextAtSize(formatCurrency(runningTotal), 11) - 20,
    y: yPosition,
    size: 11,
    font: helveticaBoldFont,
  })
  const totalText = formatCurrency(runningTotal)
  const totalW = helveticaBoldFont.widthOfTextAtSize(totalText, 11)
  page.drawText(totalText, { x: amountCol + 100 - totalW, y: yPosition, size: 11, font: helveticaBoldFont })
  yPosition -= 30

  // ---------------- Disclosure ----------------
  if (lh.taxDeductibleDisclosure) {
    draw(lh.taxDeductibleDisclosure, margin, { size: 9, color: rgb(0.42, 0.45, 0.5) })
    skipLine(6)
  }

  // ---------------- Signature ----------------
  if (lh.signatureName || lh.signatureTitle) {
    yPosition -= 30
    page.drawLine({
      start: { x: margin, y: yPosition + 6 },
      end: { x: margin + 200, y: yPosition + 6 },
      thickness: 0.75,
      color: rgb(0.5, 0.5, 0.55),
    })
    if (lh.signatureName) draw(lh.signatureName, margin, { font: helveticaBoldFont, size: 10 })
    if (lh.signatureTitle) draw(lh.signatureTitle, margin, { size: 9, color: rgb(0.42, 0.45, 0.5) })
  }

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}
