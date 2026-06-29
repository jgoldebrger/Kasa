'use client'

import { useEffect, useState } from 'react'
import { Button, Modal, Textarea } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

export interface SupportModeEnterConfirm {
  reason: string
  readOnly: boolean
}

interface SupportModeEnterModalProps {
  open: boolean
  organizationName: string
  onClose: () => void
  onConfirm: (payload: SupportModeEnterConfirm) => void
  confirming?: boolean
}

export default function SupportModeEnterModal({
  open,
  organizationName,
  onClose,
  onConfirm,
  confirming = false,
}: SupportModeEnterModalProps) {
  const t = useT()
  const [reason, setReason] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setReason('')
    setReadOnly(false)
    setError(null)
  }, [open])

  function handleConfirm() {
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setError(t('admin.supportMode.reasonTooShort'))
      return
    }
    setError(null)
    onConfirm({ reason: trimmed, readOnly })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.supportMode.modalTitle')}
      description={t('admin.supportMode.modalDescription').replace('{orgName}', organizationName)}
      dismissible={!confirming}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={confirming}>
            {t('admin.supportMode.cancel')}
          </Button>
          <Button type="button" loading={confirming} onClick={handleConfirm}>
            {t('admin.supportMode.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label={t('admin.supportMode.reasonLabel')}
          required
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            if (error) setError(null)
          }}
          error={error}
          placeholder={t('admin.supportMode.reasonPlaceholder')}
        />
        <label className="inline-flex items-start gap-2 text-sm text-fg cursor-pointer">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-ring"
          />
          <span>{t('admin.supportMode.readOnlyLabel')}</span>
        </label>
      </div>
    </Modal>
  )
}
