'use client'

import { useMemo, useState } from 'react'
import { PaperAirplaneIcon } from '@heroicons/react/24/outline'
import { useToast } from '@/app/components/Toast'
import { Alert, Button, Input, Modal, Textarea } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

export interface EmailFamilyRow {
  _id: string
  name: string
  email?: string
  emailOptOut?: boolean
  emailDeliverabilityWarning?: boolean
  emailFormatInvalid?: boolean
}

export interface EmailFamiliesModalProps {
  open: boolean
  onClose: () => void
  families: EmailFamilyRow[]
  selectedIds: Set<string>
  onSent?: () => void
}

export default function EmailFamiliesModal({
  open,
  onClose,
  families,
  selectedIds,
  onSent,
}: EmailFamiliesModalProps) {
  const t = useT()
  const toast = useToast()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const { emailable, skippedNoEmail, skippedOptOut, skippedInvalidFormat, warnDeliverability } =
    useMemo(() => {
      const selected = families.filter((f) => selectedIds.has(f._id))
      const noEmail = selected.filter((f) => !f.email?.trim())
      const invalidFormat = selected.filter((f) => f.email?.trim() && f.emailFormatInvalid === true)
      const optedOut = selected.filter(
        (f) => f.email?.trim() && !f.emailFormatInvalid && f.emailOptOut,
      )
      const emailable = selected.filter(
        (f) => f.email?.trim() && !f.emailFormatInvalid && !f.emailOptOut,
      )
      const deliverability = emailable.filter((f) => f.emailDeliverabilityWarning === true)
      return {
        emailable,
        skippedNoEmail: noEmail,
        skippedOptOut: optedOut,
        skippedInvalidFormat: invalidFormat,
        warnDeliverability: deliverability,
      }
    }, [families, selectedIds])

  const resetAndClose = () => {
    setSubject('')
    setBody('')
    onClose()
  }

  const sendBulk = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error(t('families.emailBulk.error.missingFields'))
      return
    }
    if (emailable.length === 0) {
      toast.error(t('families.emailBulk.noRecipients'))
      return
    }

    const html = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${body
      .split('\n')
      .map((line) => `<p>${line.replace(/</g, '&lt;')}</p>`)
      .join('')}</div>`

    setSending(true)
    try {
      const res = await fetch('/api/emails/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyIds: emailable.map((f) => f._id),
          subject: subject.trim(),
          html,
          text: body,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Send failed')
      const sent = data.sent ?? 0
      const failed = data.failed ?? 0
      if (failed > 0 && Array.isArray(data.errors) && data.errors.length > 0) {
        toast.error(data.errors.slice(0, 2).join(' · '))
      }
      if (sent > 0) {
        toast.success(
          t('families.emailBulk.sendResult')
            .replace('{sent}', String(sent))
            .replace('{failed}', String(failed)),
        )
      }
      resetAndClose()
      onSent?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('families.emailBulk.error.send'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title={t('families.emailBulk.title').replace('{count}', String(selectedIds.size))}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {skippedNoEmail.length > 0 && (
          <p className="text-sm text-warning">
            {t('families.emailBulk.skippedNoEmail').replace(
              '{count}',
              String(skippedNoEmail.length),
            )}
          </p>
        )}
        {skippedOptOut.length > 0 && (
          <p className="text-sm text-fg-muted">
            {t('families.emailBulk.skippedOptOut').replace('{count}', String(skippedOptOut.length))}
          </p>
        )}
        {skippedInvalidFormat.length > 0 && (
          <p className="text-sm text-warning">
            {t('families.emailBulk.warnInvalidFormat').replace(
              '{count}',
              String(skippedInvalidFormat.length),
            )}
          </p>
        )}
        {warnDeliverability.length > 0 && (
          <Alert variant="warning" title={t('families.email.deliverabilityWarningShort')}>
            {t('families.emailBulk.warnDeliverability').replace(
              '{count}',
              String(warnDeliverability.length),
            )}
          </Alert>
        )}
        {emailable.length > 0 && (
          <p className="text-sm text-fg-muted">
            {t('families.emailBulk.recipients').replace('{count}', String(emailable.length))}
          </p>
        )}
        <Input
          label={t('families.emailBulk.subject')}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('families.emailBulk.subjectPlaceholder')}
        />
        <Textarea
          label={t('families.emailBulk.body')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder={t('families.emailBulk.bodyPlaceholder')}
          hint={t('families.emailBulk.bodyHint')}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={resetAndClose} disabled={sending}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={sending}
            disabled={emailable.length === 0}
            onClick={() => void sendBulk()}
            leftIcon={<PaperAirplaneIcon className="h-4 w-4" />}
          >
            {t('families.emailBulk.send').replace('{count}', String(emailable.length))}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
