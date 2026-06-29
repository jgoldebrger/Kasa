'use client'

import { useEffect, useState } from 'react'
import { Button, Modal, Textarea } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import { SUPPORT_MODE_SCOPES, type SupportModeScope } from '@/lib/support-mode-scope'

export interface SupportModeEnterConfirm {
  reason: string
  readOnly: boolean
  scope: SupportModeScope
}

interface SupportModeEnterModalProps {
  open: boolean
  organizationName: string
  onClose: () => void
  onConfirm: (payload: SupportModeEnterConfirm) => void
  confirming?: boolean
}

const SCOPE_I18N: Record<SupportModeScope, { label: MessageKey; description: MessageKey }> = {
  full: {
    label: 'admin.supportMode.scopeFull',
    description: 'admin.supportMode.scopeFullDescription',
  },
  communications: {
    label: 'admin.supportMode.scopeCommunications',
    description: 'admin.supportMode.scopeCommunicationsDescription',
  },
  billing: {
    label: 'admin.supportMode.scopeBilling',
    description: 'admin.supportMode.scopeBillingDescription',
  },
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
  const [scope, setScope] = useState<SupportModeScope>('full')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setReason('')
    setReadOnly(false)
    setScope('full')
    setError(null)
  }, [open])

  function handleConfirm() {
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setError(t('admin.supportMode.reasonTooShort'))
      return
    }
    setError(null)
    onConfirm({ reason: trimmed, readOnly, scope })
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
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">
            {t('admin.supportMode.scopeLabel')}
          </legend>
          {SUPPORT_MODE_SCOPES.map((value) => (
            <label
              key={value}
              className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent/5"
            >
              <input
                type="radio"
                name="support-mode-scope"
                value={value}
                checked={scope === value}
                onChange={() => setScope(value)}
                className="mt-0.5 h-4 w-4 border-border text-accent focus-ring"
              />
              <span>
                <span className="font-medium text-fg">{t(SCOPE_I18N[value].label)}</span>
                <span className="block text-fg-muted">{t(SCOPE_I18N[value].description)}</span>
              </span>
            </label>
          ))}
        </fieldset>
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
