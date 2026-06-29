'use client'

import { useEffect, useState } from 'react'
import { Modal, Button, SkeletonRows } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

export type AutomationRecipientPreview = {
  recipientCount: number
  sampleFamilies: Array<{ id: string; name: string; email: string }>
  skipped: { noEmail: number; optOut: number }
}

interface AutomationRecipientsModalProps {
  open: boolean
  ruleId: string | null
  ruleName: string
  onClose: () => void
}

function tf(t: ReturnType<typeof useT>, key: string, fallback: string) {
  return t(key as MessageKey, fallback)
}

export default function AutomationRecipientsModal({
  open,
  ruleId,
  ruleName,
  onClose,
}: AutomationRecipientsModalProps) {
  const t = useT()
  const toast = useToast()
  const [preview, setPreview] = useState<AutomationRecipientPreview | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !ruleId) {
      setPreview(null)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const res = await fetch(`/api/email-automation-rules/${ruleId}/preview`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Preview failed')
        if (!cancelled) setPreview((data.data ?? data) as AutomationRecipientPreview)
      } catch (err: unknown) {
        if (!cancelled) {
          toast.error(
            err instanceof Error
              ? err.message
              : tf(t, 'communications.automations.previewError', 'Could not preview recipients.'),
          )
          setPreview(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, ruleId, t, toast])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tf(t, 'communications.automations.previewTitle', 'Preview recipients')}
      description={ruleName}
      maxWidth="max-w-lg"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {tf(t, 'communications.automations.previewClose', 'Close')}
        </Button>
      }
    >
      {loading ? (
        <SkeletonRows count={3} />
      ) : preview ? (
        <div className="space-y-4">
          <p className="text-sm text-fg">
            {tf(
              t,
              'communications.automations.previewCount',
              '{count} families would receive this email.',
            ).replace('{count}', String(preview.recipientCount))}
          </p>

          {(preview.skipped.noEmail > 0 || preview.skipped.optOut > 0) && (
            <div className="text-sm text-fg-muted space-y-1">
              {preview.skipped.noEmail > 0 && (
                <p>
                  {tf(
                    t,
                    'communications.automations.previewSkippedNoEmail',
                    '{count} skipped (no email).',
                  ).replace('{count}', String(preview.skipped.noEmail))}
                </p>
              )}
              {preview.skipped.optOut > 0 && (
                <p>
                  {tf(
                    t,
                    'communications.automations.previewSkippedOptOut',
                    '{count} skipped (opted out).',
                  ).replace('{count}', String(preview.skipped.optOut))}
                </p>
              )}
            </div>
          )}

          {preview.sampleFamilies.length > 0 && (
            <div>
              <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-2">
                {tf(t, 'communications.automations.previewSample', 'Sample recipients')}
              </p>
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {preview.sampleFamilies.map((family) => (
                  <li key={family.id} className="px-3 py-2">
                    <p className="font-medium text-fg">{family.name || '—'}</p>
                    <p className="text-fg-muted truncate">{family.email}</p>
                  </li>
                ))}
              </ul>
              {preview.recipientCount > preview.sampleFamilies.length && (
                <p className="text-xs text-fg-muted mt-2">
                  {tf(
                    t,
                    'communications.automations.previewSampleMore',
                    'Showing {shown} of {total}.',
                  )
                    .replace('{shown}', String(preview.sampleFamilies.length))
                    .replace('{total}', String(preview.recipientCount))}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">
          {tf(t, 'communications.automations.previewEmpty', 'No matching recipients.')}
        </p>
      )}
    </Modal>
  )
}
