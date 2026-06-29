'use client'

import { Button, Modal } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { SupportSessionAction } from '@/lib/client/support-mode'

interface SupportSessionSummaryModalProps {
  open: boolean
  actions: SupportSessionAction[]
  onClose: () => void
}

export default function SupportSessionSummaryModal({
  open,
  actions,
  onClose,
}: SupportSessionSummaryModalProps) {
  const t = useT()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.supportMode.sessionSummaryTitle')}
      description={t('admin.supportMode.sessionSummaryDescription').replace(
        '{count}',
        String(actions.length),
      )}
      footer={
        <Button type="button" onClick={onClose}>
          {t('admin.supportMode.sessionSummaryClose')}
        </Button>
      }
    >
      {actions.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('admin.supportMode.sessionSummaryEmpty')}</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto divide-y divide-border rounded-md border border-border text-sm">
          {actions.map((row, i) => (
            <li key={`${row.action}-${row.at}-${i}`} className="px-3 py-2 flex flex-col gap-0.5">
              <span className="font-mono text-xs text-fg">{row.action}</span>
              <span className="text-xs text-fg-muted">
                {row.at ? new Date(row.at).toLocaleString() : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
