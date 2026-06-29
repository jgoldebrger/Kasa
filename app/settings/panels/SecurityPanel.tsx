'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'
import ReadOnlySupportGuard from '@/app/components/ReadOnlySupportGuard'
import { SettingsPanel } from '@/app/components/settings/SettingsPanel'
import { Alert, Card } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'
import ApiKeysPanel from './ApiKeysPanel'

export interface SecurityPanelProps {
  isOwner: boolean
}

export default function SecurityPanel({ isOwner }: SecurityPanelProps) {
  const t = useT()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [notifyOwnerOnSupportAccess, setNotifyOwnerOnSupportAccess] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [oidcStatus, setOidcStatus] = useState<{
    enabled: boolean
    providerName: string
    hasDomainMapping: boolean
  } | null>(null)

  const loadSecurity = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [securityRes, oidcRes] = await Promise.all([
        fetch('/api/organizations/security'),
        fetch('/api/auth/oidc-status'),
      ])
      if (!securityRes.ok) {
        setLoadError(true)
        return
      }
      const data = await securityRes.json().catch(() => ({}))
      setNotifyOwnerOnSupportAccess(data.notifyOwnerOnSupportAccess !== false)

      if (oidcRes.ok) {
        const oidc = await oidcRes.json().catch(() => null)
        if (oidc) {
          setOidcStatus({
            enabled: !!oidc.enabled,
            providerName: oidc.providerName || 'SSO',
            hasDomainMapping: !!oidc.hasDomainMapping,
          })
        }
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSecurity()
  }, [loadSecurity])

  const handleNotifyChange = async (checked: boolean) => {
    if (!isOwner) return
    setNotifyOwnerOnSupportAccess(checked)
    setSaving(true)
    try {
      const res = await fetch('/api/organizations/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyOwnerOnSupportAccess: checked }),
      })
      if (!res.ok) {
        setNotifyOwnerOnSupportAccess(!checked)
      }
    } catch {
      setNotifyOwnerOnSupportAccess(!checked)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPanel
      icon={<ShieldCheckIcon />}
      title={t('settings.security.title')}
      description={t('settings.security.description')}
      className="mb-6"
    >
      <ReadOnlySupportGuard className="mb-4" />

      {loadError && (
        <Alert variant="danger" className="mb-4" title={t('settings.security.loadError')} />
      )}

      <Card compact>
        <h3 className="text-sm font-medium text-fg">
          {t('settings.security.supportNotify.title')}
        </h3>
        <p className="mt-1 text-xs text-fg-muted">
          {t('settings.security.supportNotify.description')}
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-fg-muted">{t('settings.security.loading')}</p>
        ) : (
          <label
            className={`mt-3 flex items-start gap-3 ${isOwner && !supportReadOnly ? 'cursor-pointer' : ''}`}
          >
            <input
              type="checkbox"
              checked={notifyOwnerOnSupportAccess}
              disabled={!isOwner || supportReadOnly || saving}
              onChange={(e) => void handleNotifyChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span className="text-sm text-fg">{t('settings.security.supportNotify.label')}</span>
          </label>
        )}
        {!isOwner && !loading && (
          <p className="mt-2 text-xs text-fg-muted">{t('settings.security.ownerOnly')}</p>
        )}
      </Card>

      <Card compact className="mt-4">
        <h3 className="text-sm font-medium text-fg">{t('settings.security.sso.title')}</h3>
        <p className="mt-1 text-xs text-fg-muted">{t('settings.security.sso.description')}</p>
        {loading ? (
          <p className="mt-3 text-sm text-fg-muted">{t('settings.security.loading')}</p>
        ) : oidcStatus?.enabled ? (
          <p className="mt-3 text-sm text-fg">
            {t('settings.security.sso.enabled').replace('{provider}', oidcStatus.providerName)}
          </p>
        ) : (
          <p className="mt-3 text-sm text-fg-muted">{t('settings.security.sso.disabled')}</p>
        )}
      </Card>

      <ApiKeysPanel isOwner={isOwner} />
    </SettingsPanel>
  )
}
