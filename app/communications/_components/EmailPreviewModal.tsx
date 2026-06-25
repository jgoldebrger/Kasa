'use client'

import { Modal, Button } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { markdownToHtml, substituteMergeFields } from './email-utils'

interface EmailPreviewModalProps {
  open: boolean
  onClose: () => void
  subject: string
  body: string
  sampleFamilyName?: string
}

export default function EmailPreviewModal({
  open,
  onClose,
  subject,
  body,
  sampleFamilyName = 'Sample Family',
}: EmailPreviewModalProps) {
  const t = useT()

  const previewSubject = substituteMergeFields(subject, { familyName: sampleFamilyName })
  const previewHtml = markdownToHtml(
    substituteMergeFields(body, {
      familyName: sampleFamilyName,
      balance: '$125.00',
      dues: '$50.00',
    }),
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('communications.preview.title')}
      description={t('communications.preview.description')}
      maxWidth="max-w-2xl"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('communications.preview.close')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">
            {t('communications.field.subject')}
          </p>
          <p className="mt-1 text-sm font-medium text-fg">{previewSubject || '—'}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">
            {t('communications.field.body')}
          </p>
          <div
            className="mt-2 rounded-lg border border-border bg-surface p-4 text-sm text-fg prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>
    </Modal>
  )
}
