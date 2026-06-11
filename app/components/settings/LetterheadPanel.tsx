'use client'

import type React from 'react'
import { IdentificationIcon } from '@heroicons/react/24/outline'
import { Button, Input, Textarea } from '@/app/components/ui'

/**
 * Per-organization letterhead editor. Every field is optional free
 * text — empty values are treated as "skip this line" by the
 * downstream PDF / email renderers, so a half-populated letterhead
 * still produces a clean-looking document.
 *
 * Currently consumed by the tax-receipt PDF generator; statement PDFs
 * still use the hardcoded "Kasa Family Management" header until a
 * follow-up wires them to `letterhead.*`.
 */

export interface LetterheadShape {
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  zip: string
  phone: string
  email: string
  taxId: string
  signatureName: string
  signatureTitle: string
  statementFooter: string
  receiptThankYou: string
  taxDeductibleDisclosure: string
}

interface Props {
  letterhead: LetterheadShape
  setLetterhead: React.Dispatch<React.SetStateAction<LetterheadShape>>
  saving: boolean
  onSubmit: (e: React.FormEvent) => void | Promise<void>
}

export default function LetterheadPanel({ letterhead, setLetterhead, saving, onSubmit }: Props) {
  // Tiny local helpers so each field's onChange isn't a giant inline
  // arrow. We split <Input> vs <Textarea> bindings because their
  // onChange event types are incompatible under strict TS.
  const update = (key: keyof LetterheadShape, value: string) =>
    setLetterhead((prev) => ({ ...prev, [key]: value }))
  const bindInput = (key: keyof LetterheadShape) => ({
    value: letterhead[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => update(key, e.target.value),
  })
  const bindTextarea = (key: keyof LetterheadShape) => ({
    value: letterhead[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update(key, e.target.value),
  })

  return (
    <div className="bg-surface rounded-lg shadow-lg p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg flex items-center justify-center">
          <IdentificationIcon className="h-6 w-6 text-indigo-600 dark:text-indigo-300" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-fg">Letterhead</h2>
          <p className="text-sm text-fg-muted">
            Address, tax ID, and signature lines used on tax receipts.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-8">
        {/* Mailing address */}
        <section>
          <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide mb-3">
            Mailing address
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Address line 1" placeholder="123 Main St" {...bindInput('addressLine1')} />
            <Input label="Address line 2" placeholder="Suite 200" {...bindInput('addressLine2')} />
            <Input label="City" {...bindInput('city')} />
            <Input label="State / region" {...bindInput('state')} />
            <Input label="ZIP / postal code" {...bindInput('zip')} />
          </div>
        </section>

        {/* Contact */}
        <section>
          <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide mb-3">
            Contact
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Phone" type="tel" placeholder="(555) 123-4567" {...bindInput('phone')} />
            <Input
              label="Email"
              type="email"
              placeholder="office@example.org"
              {...bindInput('email')}
            />
          </div>
        </section>

        {/* Tax / receipts */}
        <section>
          <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide mb-3">
            Tax / receipts
          </h3>
          <div className="grid grid-cols-1 gap-4">
            <Input
              label="Tax ID (EIN)"
              hint="Shown on tax receipts so donors can claim a deduction."
              placeholder="12-3456789"
              {...bindInput('taxId')}
            />
            <Textarea
              label="Thank-you note"
              rows={2}
              hint="Optional message printed near the top of each tax receipt."
              placeholder="Thank you for your generous support of our community."
              {...bindTextarea('receiptThankYou')}
            />
            <Textarea
              label="Tax-deductible disclosure"
              rows={3}
              hint="Boilerplate sentence printed below the receipt total (e.g. IRS-style language)."
              placeholder="No goods or services were provided in exchange for this contribution."
              {...bindTextarea('taxDeductibleDisclosure')}
            />
          </div>
        </section>

        {/* Signature */}
        <section>
          <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide mb-3">
            Signature
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Signer name" placeholder="Jane Doe" {...bindInput('signatureName')} />
            <Input label="Signer title" placeholder="Treasurer" {...bindInput('signatureTitle')} />
          </div>
        </section>

        {/* Statement footer — saved here but not yet wired to PDFs/emails. */}
        <section>
          <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide mb-3">
            Statement footer
          </h3>
          <Textarea
            label="Footer text (statements)"
            rows={2}
            hint="Reserved for an upcoming change that will print this under each statement PDF. Saved now so it's ready when the statements wire-through ships."
            {...bindTextarea('statementFooter')}
          />
        </section>

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={saving}>
            Save letterhead
          </Button>
        </div>
      </form>
    </div>
  )
}
