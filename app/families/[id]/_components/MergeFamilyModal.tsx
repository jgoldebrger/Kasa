// @ts-nocheck
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowsRightLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Modal, Button, Input, Alert } from '@/app/components/ui'
import { useToast, useConfirm } from '@/app/components/Toast'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { useT } from '@/lib/client/i18n'

interface FamilyOption {
  _id: string
  name: string
}

interface MergePreview {
  sourceFamily: { _id: string; name: string }
  targetFamily: { _id: string; name: string }
  counts: {
    members: number
    payments: number
    lifecycleEvents: number
    withdrawals: number
    cycleCharges: number
    cycleChargeConflicts: number
    statements: number
    tasks: number
    savedPaymentMethods: number
    recurringPayments: number
    subFamilies: number
  }
  warnings: string[]
}

export default function MergeFamilyModal({
  open,
  onClose,
  sourceFamilyId,
  sourceFamilyName,
}: {
  open: boolean
  onClose: () => void
  sourceFamilyId: string
  sourceFamilyName: string
}) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [families, setFamilies] = useState<FamilyOption[]>([])
  const [loadingFamilies, setLoadingFamilies] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [merging, setMerging] = useState(false)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (!open) {
      setSearch('')
      setTargetId('')
      setPreview(null)
      setPreviewError('')
      return
    }

    let cancelled = false
    setLoadingFamilies(true)
    fetch('/api/families?limit=500')
      .then((res) => (res.ok ? res.json() : { families: [] }))
      .then((data) => {
        if (cancelled) return
        const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
        setFamilies(
          rows
            .filter((f: any) => String(f._id) !== sourceFamilyId)
            .map((f: any) => ({ _id: String(f._id), name: f.name || 'Unnamed family' })),
        )
      })
      .catch(() => {
        if (!cancelled) setFamilies([])
      })
      .finally(() => {
        if (!cancelled) setLoadingFamilies(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, sourceFamilyId])

  const filteredFamilies = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return families.slice(0, 50)
    return families.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 50)
  }, [families, search])

  const loadPreview = useCallback(
    async (tid: string) => {
      if (!tid) {
        setPreview(null)
        setPreviewError('')
        return
      }
      setLoadingPreview(true)
      setPreviewError('')
      try {
        const res = await fetch(
          `/api/families/merge/preview?sourceFamilyId=${encodeURIComponent(sourceFamilyId)}&targetFamilyId=${encodeURIComponent(tid)}`,
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setPreview(null)
          setPreviewError(body?.error || 'Could not preview merge impact.')
          return
        }
        setPreview(body)
      } catch {
        setPreview(null)
        setPreviewError('Could not preview merge impact.')
      } finally {
        setLoadingPreview(false)
      }
    },
    [sourceFamilyId],
  )

  useEffect(() => {
    if (!targetId) {
      setPreview(null)
      setPreviewError('')
      return
    }
    void loadPreview(targetId)
  }, [targetId, loadPreview])

  const impactRows = preview
    ? [
        { label: t('family.merge.impact.members'), count: preview.counts.members },
        { label: t('family.merge.impact.payments'), count: preview.counts.payments },
        { label: t('family.merge.impact.events'), count: preview.counts.lifecycleEvents },
        { label: t('family.merge.impact.withdrawals'), count: preview.counts.withdrawals },
        { label: t('family.merge.impact.statements'), count: preview.counts.statements },
        { label: t('family.merge.impact.cycleCharges'), count: preview.counts.cycleCharges },
        { label: t('family.merge.impact.tasks'), count: preview.counts.tasks },
        { label: t('family.merge.impact.subFamilies'), count: preview.counts.subFamilies },
      ].filter((row) => row.count > 0)
    : []

  const handleMerge = async () => {
    if (!preview || !targetId) return
    const ok = await confirm({
      title: t('family.merge.confirmTitle'),
      message: t('family.merge.confirmMessage')
        .replace('{source}', preview.sourceFamily.name)
        .replace('{target}', preview.targetFamily.name),
      destructive: true,
      confirmLabel: t('family.merge.confirmAction'),
    })
    if (!ok) return

    setMerging(true)
    try {
      const res = await fetch('/api/families/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFamilyId,
          targetFamilyId: targetId,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error || t('family.merge.error'))
        return
      }
      invalidateCache(/^\/api\/families/)
      invalidateCache(/^\/api\/dashboard-stats/)
      toast.success(t('family.merge.success').replace('{name}', preview.targetFamily.name))
      onClose()
      router.push(`/families/${targetId}`)
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setMerging(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('family.merge.title')}
      description={t('family.merge.description').replace('{name}', sourceFamilyName)}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="merge-target-search" className="mb-1 block text-sm font-medium text-fg">
            {t('family.merge.targetLabel')}
          </label>
          <Input
            id="merge-target-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('family.merge.targetPlaceholder')}
            disabled={loadingFamilies || merging}
          />
        </div>

        <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
          {loadingFamilies ? (
            <p className="p-3 text-sm text-fg-muted">{t('common.loading')}</p>
          ) : filteredFamilies.length === 0 ? (
            <p className="p-3 text-sm text-fg-muted">{t('family.merge.noTargets')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {filteredFamilies.map((f) => (
                <li key={f._id}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-fg/5 ${
                      targetId === f._id ? 'bg-accent/10 font-medium text-accent' : 'text-fg'
                    }`}
                    onClick={() => setTargetId(f._id)}
                    disabled={merging}
                  >
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {loadingPreview && (
          <p className="text-sm text-fg-muted">{t('family.merge.loadingPreview')}</p>
        )}

        {previewError && (
          <Alert variant="danger" className="text-sm">
            {previewError}
          </Alert>
        )}

        {preview && (
          <div className="space-y-3 rounded-lg border border-border bg-app-subtle p-4">
            <div className="flex items-start gap-2 text-sm">
              <ArrowsRightLeftIcon
                className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted"
                aria-hidden="true"
              />
              <p>
                <span className="font-medium">{preview.sourceFamily.name}</span>
                {' → '}
                <span className="font-medium">{preview.targetFamily.name}</span>
              </p>
            </div>

            {impactRows.length > 0 ? (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {impactRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between gap-2 rounded-md bg-surface px-2 py-1"
                  >
                    <dt className="text-fg-muted">{row.label}</dt>
                    <dd className="font-medium tabular">{row.count}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-fg-muted">{t('family.merge.noRecords')}</p>
            )}

            {preview.warnings.length > 0 && (
              <div className="space-y-2">
                {preview.warnings.map((warning) => (
                  <Alert key={warning} variant="warning" className="text-xs">
                    <div className="flex gap-2">
                      <ExclamationTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{warning}</span>
                    </div>
                  </Alert>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={merging}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleMerge()}
            disabled={!preview || merging || !!previewError}
            loading={merging}
          >
            {t('family.merge.confirmAction')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
