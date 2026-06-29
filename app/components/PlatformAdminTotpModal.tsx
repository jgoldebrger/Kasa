'use client'

import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

interface PlatformAdminTotpModalProps {
  open: boolean
  onClose: () => void
  onVerified: () => void | Promise<void>
}

export default function PlatformAdminTotpModal({
  open,
  onClose,
  onVerified,
}: PlatformAdminTotpModalProps) {
  const t = useT()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCode('')
    setError(null)
    setBusy(false)
  }, [open])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) {
      setError(t('admin.platformTotp.codeRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/verify-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t('admin.platformTotp.invalidCode'))
        return
      }
      await onVerified()
    } catch {
      setError(t('admin.platformTotp.networkError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.platformTotp.title')}
      description={t('admin.platformTotp.description')}
      dismissible={!busy}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('admin.platformTotp.cancel')}
          </Button>
          <Button type="submit" form="platform-admin-totp-form" loading={busy}>
            {t('admin.platformTotp.verify')}
          </Button>
        </>
      }
    >
      <form id="platform-admin-totp-form" onSubmit={handleVerify} className="space-y-4" noValidate>
        <Input
          label={t('admin.platformTotp.codeLabel')}
          required
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456 / XXXX-XXXX"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            if (error) setError(null)
          }}
          error={error}
        />
        <p className="text-xs text-fg-muted">{t('admin.platformTotp.hint')}</p>
      </form>
    </Modal>
  )
}
