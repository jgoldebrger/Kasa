'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyIcon, ClipboardIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline'
import ReadOnlySupportGuard from '@/app/components/ReadOnlySupportGuard'
import { useToast, useConfirm } from '@/app/components/Toast'
import { Alert, Button, Card, Input } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'
import { useCopyToClipboard } from '@/lib/client/useCopyToClipboard'

interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  createdAt: string
}

export interface ApiKeysPanelProps {
  isOwner: boolean
}

export default function ApiKeysPanel({ isOwner }: ApiKeysPanelProps) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { copy, copied } = useCopyToClipboard()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)

  const loadKeys = useCallback(async () => {
    if (!isOwner) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/organizations/api-keys')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const data = await res.json().catch(() => ({}))
      setKeys(data.keys || [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [isOwner])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const handleCreate = async () => {
    if (!name.trim() || supportReadOnly) return
    setCreating(true)
    try {
      const res = await fetch('/api/organizations/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || t('settings.apiKeys.createError'))
        return
      }
      setNewToken(data.key?.token || null)
      setName('')
      toast.success(t('settings.apiKeys.created'))
      void loadKeys()
    } catch {
      toast.error(t('settings.apiKeys.createError'))
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (row: ApiKeyRow) => {
    const ok = await confirm({
      title: t('settings.apiKeys.revokeConfirmTitle'),
      message: t('settings.apiKeys.revokeConfirmMessage').replace('{name}', row.name),
      destructive: true,
      confirmLabel: t('settings.apiKeys.revoke'),
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/organizations/api-keys?id=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || t('settings.apiKeys.revokeError'))
        return
      }
      toast.success(t('settings.apiKeys.revoked'))
      void loadKeys()
    } catch {
      toast.error(t('settings.apiKeys.revokeError'))
    }
  }

  if (!isOwner) return null

  return (
    <Card compact className="mt-4">
      <div className="flex items-center gap-2 mb-1">
        <KeyIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
        <h3 className="text-sm font-medium text-fg">{t('settings.apiKeys.title')}</h3>
      </div>
      <p className="text-xs text-fg-muted">{t('settings.apiKeys.description')}</p>

      <ReadOnlySupportGuard className="mt-3" />

      {loadError && (
        <Alert variant="danger" className="mt-3" title={t('settings.apiKeys.loadError')} />
      )}

      {newToken && (
        <Alert variant="warning" className="mt-3" title={t('settings.apiKeys.showOnceTitle')}>
          <p className="text-sm mt-1">{t('settings.apiKeys.showOnceBody')}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 text-xs break-all bg-fg/5 rounded px-2 py-1">{newToken}</code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copy(newToken)}
              aria-label={t('settings.apiKeys.copy')}
            >
              {copied ? (
                <CheckIcon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ClipboardIcon className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setNewToken(null)}
          >
            {t('settings.apiKeys.dismissToken')}
          </Button>
        </Alert>
      )}

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <Input
          label={t('settings.apiKeys.nameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.apiKeys.namePlaceholder')}
          disabled={supportReadOnly || creating}
          className="flex-1"
        />
        <Button
          type="button"
          onClick={() => void handleCreate()}
          loading={creating}
          disabled={!name.trim() || supportReadOnly}
          className="sm:self-end"
        >
          {t('settings.apiKeys.create')}
        </Button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">{t('settings.apiKeys.loading')}</p>
      ) : keys.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{t('settings.apiKeys.empty')}</p>
      ) : (
        <ul className="mt-4 space-y-2" role="list">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg truncate">{k.name}</p>
                <p className="text-xs text-fg-muted font-mono">
                  {k.prefix}… · {k.scopes.join(', ')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={supportReadOnly}
                onClick={() => void handleRevoke(k)}
                aria-label={t('settings.apiKeys.revoke')}
              >
                <TrashIcon className="h-4 w-4 text-red-600" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
