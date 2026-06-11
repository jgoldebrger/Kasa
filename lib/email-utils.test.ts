import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateStatementPDF,
  generateTaxReceiptPDF,
  type StatementTransaction,
  type TaxReceiptOrg,
  type TaxReceiptFamily,
  type TaxReceiptPayment,
} from './email-utils'

const baseStatement = {
  statementNumber: 'STMT-001',
  date: new Date('2024-06-30'),
  fromDate: new Date('2024-06-01'),
  toDate: new Date('2024-06-30'),
  openingBalance: 1000,
  income: 500,
  withdrawals: 200,
  expenses: 50,
  cycleCharges: 0,
  closingBalance: 1250,
}

function expectValidPdf(buffer: Buffer) {
  expect(Buffer.isBuffer(buffer)).toBe(true)
  expect(buffer.length).toBeGreaterThan(100)
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF')
}

describe('generateStatementPDF', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a minimal PDF with default org branding', async () => {
    const pdf = await generateStatementPDF(
      { ...baseStatement, cycleCharges: 0 },
      'Cohen Family',
      [],
      null,
    )
    expectValidPdf(pdf)
  })

  it('renders Hebrew locale (dates/currency), full letterhead, cycle charges, and custom footer', async () => {
    // Standard PDF fonts are WinAnsi-only; redirect he-IL Intl output to en-US for PDF safety.
    const origToLocaleDateString = Date.prototype.toLocaleDateString
    const dateSpy = vi.spyOn(Date.prototype, 'toLocaleDateString')
    dateSpy.mockImplementation(function (this: Date, locales?, options?) {
      const loc = typeof locales === 'string' ? locales : Array.isArray(locales) ? locales[0] : undefined
      if (loc === 'he-IL') {
        return origToLocaleDateString.call(this, 'en-US', options)
      }
      return origToLocaleDateString.call(this, locales, options)
    })
    const RealNumberFormat = Intl.NumberFormat
    function redirectHeILNumberFormat(
      locale?: string | string[],
      options?: Intl.NumberFormatOptions,
    ) {
      const loc = typeof locale === 'string' ? locale : Array.isArray(locale) ? locale[0] : undefined
      return new RealNumberFormat(loc === 'he-IL' ? 'en-US' : (locale as string), options)
    }
    const nfSpy = vi
      .spyOn(Intl, 'NumberFormat')
      .mockImplementation(redirectHeILNumberFormat as unknown as typeof Intl.NumberFormat)

    const pdf = await generateStatementPDF(
      {
        ...baseStatement,
        cycleCharges: 150,
        date: '2024-06-30',
        fromDate: '2024-06-01',
        toDate: '2024-06-30',
      },
      'Cohen Family',
      [],
      {
        name: 'Kehila Test',
        locale: 'he-IL',
        currency: 'USD',
        letterhead: {
          addressLine1: '1 Herzl Street',
          addressLine2: 'Floor 2',
          city: 'Tel Aviv',
          zip: '6100001',
          phone: '03-1234567',
          email: 'office@example.org',
          statementFooter: 'Thank you for your partnership.\nQuestions? Contact us.',
        },
      },
    )
    expectValidPdf(pdf)
    expect(dateSpy.mock.calls.some((c) => c[0] === 'he-IL')).toBe(true)
    expect(nfSpy.mock.calls.some((c) => c[0] === 'he-IL')).toBe(true)
  })

  it('wraps long header text and uses default org name when name is blank', async () => {
    const longName = Array.from({ length: 40 }, (_, i) => `Word${i}`).join(' ')
    const pdfDefaultName = await generateStatementPDF(baseStatement, 'Smith Family', [], {
      name: '   ',
    })
    expectValidPdf(pdfDefaultName)

    const pdfWrapped = await generateStatementPDF(baseStatement, 'Smith Family', [], {
      name: longName,
      letterhead: {
        addressLine1: Array.from({ length: 30 }, (_, i) => `Segment${i}`).join(' '),
      },
    })
    expectValidPdf(pdfWrapped)
  })

  it('renders transaction types, truncations, invalid dates, and triggers pagination', async () => {
    const transactions: StatementTransaction[] = [
      {
        type: 'payment',
        date: new Date('2024-06-05'),
        description: 'Tuition payment for spring semester',
        amount: 250,
        notes: 'Check #1001 deposited at branch',
      },
      {
        type: 'withdrawal',
        date: '2024-06-10',
        description: 'Camp scholarship disbursement',
        amount: -75,
      },
      {
        type: 'cycle-charge',
        date: new Date('2024-06-15'),
        description: 'Annual membership dues',
        amount: -100,
        notes: 'Auto-billed',
      },
      {
        type: 'event',
        date: 'not-a-valid-date',
        description: 'Lifecycle event fee',
        amount: 25,
        notes: undefined,
      },
    ]

    // Enough rows to force a new page mid-table (yPosition < 100).
    for (let i = 0; i < 45; i++) {
      transactions.push({
        type: 'payment',
        date: new Date(`2024-06-${String((i % 28) + 1).padStart(2, '0')}`),
        description: `Bulk line item ${i}`,
        amount: i % 2 === 0 ? 10 : -5,
        notes: i % 3 === 0 ? `Note row ${i}` : '-',
      })
    }

    const pdf = await generateStatementPDF(
      {
        ...baseStatement,
        cycleCharges: 99,
        date: 'invalid',
        fromDate: 'also-invalid',
        toDate: new Date('2024-06-30'),
      },
      'Large Ledger Family',
      transactions,
      { name: 'Test Congregation', locale: 'en-US', currency: 'USD' },
    )
    expectValidPdf(pdf)
  })

  it('falls back when locale/currency are invalid', async () => {
    const pdf = await generateStatementPDF(
      {
        ...baseStatement,
        date: new Date('2024-01-15'),
      },
      'Fallback Family',
      [
        {
          type: 'payment',
          date: new Date('2024-01-10'),
          description: 'Donation',
          amount: 50,
        },
      ],
      {
        name: 'Bad Locale Org',
        locale: 'xx-INVALID',
        currency: 'NOTREAL',
      },
    )
    expectValidPdf(pdf)
  })

  it('formatDate falls back to en-US when locale date formatting throws', async () => {
    const orig = Date.prototype.toLocaleDateString
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      locales?,
      options?,
    ) {
      const loc = typeof locales === 'string' ? locales : undefined
      if (loc === 'xx-INVALID') {
        throw new RangeError('invalid locale')
      }
      return orig.call(this, locales, options)
    })

    const pdf = await generateStatementPDF(
      { ...baseStatement, date: new Date('2024-06-15') },
      'Date Fallback Family',
      [],
      { name: 'Org', locale: 'xx-INVALID', currency: 'USD' },
    )
    expectValidPdf(pdf)
  })

  it('starts transactions on a new page when header content fills the first page', async () => {
    const hugeOrgName = Array.from({ length: 80 }, (_, i) => `Segment${i}`).join(' ')
    const pdf = await generateStatementPDF(
      { ...baseStatement, cycleCharges: 250 },
      'Family',
      [{ type: 'payment', date: new Date('2024-06-01'), description: 'Pay', amount: 10 }],
      {
        name: hugeOrgName,
        letterhead: {
          addressLine1: Array.from({ length: 50 }, (_, i) => `Addr${i}`).join(' '),
          addressLine2: 'Suite 9000',
          city: 'Metro',
          state: 'ST',
          zip: '00000',
          phone: '555-0000',
          email: 'a@b.org',
        },
      },
    )
    expectValidPdf(pdf)
  })

  it('rethrows when PDF creation fails', async () => {
    const pdfLib = await import('pdf-lib')
    const spy = vi.spyOn(pdfLib.PDFDocument, 'create').mockRejectedValueOnce(
      new Error('PDF mock failure'),
    )
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      generateStatementPDF(baseStatement, 'Fail Family', [], { name: 'Org' }),
    ).rejects.toThrow('PDF mock failure')
    spy.mockRestore()
    errSpy.mockRestore()
  })
})

describe('generateTaxReceiptPDF', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const fullOrg: TaxReceiptOrg = {
    name: 'Temple Beth Example',
    locale: 'en-US',
    currency: 'USD',
    letterhead: {
      addressLine1: '123 Main Street',
      addressLine2: 'Suite 200',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
      phone: '(555) 123-4567',
      email: 'treasurer@example.org',
      taxId: '12-3456789',
      signatureName: 'Jane Treasurer',
      signatureTitle: 'Financial Secretary',
      receiptThankYou:
        'Thank you for your generous support of our community programs.',
      taxDeductibleDisclosure:
        'No goods or services were provided in exchange for these contributions.',
    },
  }

  const fullFamily: TaxReceiptFamily = {
    name: 'Cohen Family',
    street: '45 Oak Avenue',
    city: 'Springfield',
    state: 'IL',
    zip: '62702',
  }

  it('renders a receipt with full letterhead and payments table', async () => {
    const payments: TaxReceiptPayment[] = [
      {
        date: new Date('2024-03-15'),
        method: 'Credit card online portal',
        amount: 500,
        notes: 'Pesach campaign — early bird',
      },
      {
        date: '2024-07-04',
        method: 'Check',
        amount: 250,
        notes: 'Mailed with envelope',
      },
      {
        date: 'not-a-date',
        method: 'Cash',
        amount: 100,
      },
    ]

    const pdf = await generateTaxReceiptPDF(fullOrg, fullFamily, payments, 2024)
    expectValidPdf(pdf)
  })

  it('renders with empty letterhead (org name only)', async () => {
    const pdf = await generateTaxReceiptPDF(
      { name: 'Minimal Org', locale: 'en-US', currency: 'USD', letterhead: null },
      { name: 'Donor Only' },
      [],
      2023,
    )
    expectValidPdf(pdf)
  })

  it('paginates many payment rows and truncates long method/notes', async () => {
    const payments: TaxReceiptPayment[] = []
    for (let i = 0; i < 55; i++) {
      payments.push({
        date: new Date(`2024-${String((i % 12) + 1).padStart(2, '0')}-15`),
        method: `Very long payment method description ${i}`,
        amount: 25 + i,
        notes: `Extended donor note for row ${i} with extra detail`,
      })
    }

    const pdf = await generateTaxReceiptPDF(
      fullOrg,
      fullFamily,
      payments,
      2024,
    )
    expectValidPdf(pdf)
  })

  it('falls back when locale/currency are invalid', async () => {
    const pdf = await generateTaxReceiptPDF(
      {
        name: '',
        locale: 'bad-locale-!!!',
        currency: 'FAKE',
        letterhead: {},
      },
      { name: 'Test Donor' },
      [{ date: new Date('2024-05-01'), method: 'ACH', amount: 75 }],
      2024,
    )
    expectValidPdf(pdf)
  })

  it('formatDate falls back to en-US when locale date formatting throws', async () => {
    const orig = Date.prototype.toLocaleDateString
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      locales?,
      options?,
    ) {
      const loc = typeof locales === 'string' ? locales : undefined
      if (loc === 'bad-locale-!!!') {
        throw new RangeError('invalid locale')
      }
      return orig.call(this, locales, options)
    })

    const pdf = await generateTaxReceiptPDF(
      { name: 'Org', locale: 'bad-locale-!!!', currency: 'USD' },
      { name: 'Donor' },
      [{ date: new Date('2024-05-01'), method: 'Check', amount: 50 }],
      2024,
    )
    expectValidPdf(pdf)
  })

  it('renders signature block with name only', async () => {
    const pdf = await generateTaxReceiptPDF(
      {
        name: 'Sign Org',
        letterhead: { signatureName: 'Rabbi Example' },
      },
      { name: 'Family' },
      [{ date: new Date('2024-12-01'), method: 'Check', amount: 100 }],
      2024,
    )
    expectValidPdf(pdf)
  })

  it('renders signature block with title only', async () => {
    const pdf = await generateTaxReceiptPDF(
      {
        name: 'Sign Org',
        letterhead: { signatureTitle: 'President' },
      },
      { name: 'Family' },
      [{ date: new Date('2024-12-01'), method: 'Check', amount: 100 }],
      2024,
    )
    expectValidPdf(pdf)
  })
})
