'use client'

import { useCallback, useRef, useState } from 'react'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { ArrowUpTrayIcon, PhotoIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Button, SkeletonRows } from '@/app/components/ui'
import { useConfirm, useToast } from '@/app/components/Toast'
import { notifyBrandingUpdated, useOrgBranding } from '@/lib/client/useOrgBranding'

interface BrandingPanelProps {
  /** Owner / admin can write; member sees a read-only view. */
  canManage: boolean
}

const MAX_BYTES = 1.5 * 1024 * 1024 // 1.5 MB — server resizes to ≤200KB

export default function BrandingPanel({ canManage }: BrandingPanelProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const { branding, loading, refresh } = useOrgBranding()

  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useOrgChanged(useCallback(() => {
    setPendingPreview(null)
    if (fileRef.current) fileRef.current.value = ''
    void refresh()
  }, [refresh]))

  const onFileChange = useCallback(
    async (file: File | null) => {
      if (!file) {
        setPendingPreview(null)
        return
      }
      if (file.size > MAX_BYTES) {
        toast.error('Logo is too large. Max 1.5 MB.')
        return
      }
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(file.type)) {
        toast.error('Use a PNG, JPEG, WEBP, GIF, or SVG.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => setPendingPreview(String(reader.result || ''))
      reader.onerror = () => toast.error('Could not read file.')
      reader.readAsDataURL(file)
    },
    [toast],
  )

  const save = useCallback(async () => {
    if (!pendingPreview) return
    setSaving(true)
    try {
      const res = await fetch('/api/organizations/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoDataUrl: pendingPreview }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not save logo.')
        return
      }
      toast.success('Logo updated.')
      setPendingPreview(null)
      if (fileRef.current) fileRef.current.value = ''
      notifyBrandingUpdated()
      await refresh()
    } catch {
      toast.error('Could not save logo.')
    } finally {
      setSaving(false)
    }
  }, [pendingPreview, toast, refresh])

  const clear = useCallback(async () => {
    const ok = await confirm({
      title: 'Remove custom logo?',
      message: 'The default Kasa tile will be shown instead.',
      confirmLabel: 'Remove logo',
      destructive: true,
    })
    if (!ok) return
    setClearing(true)
    try {
      const res = await fetch('/api/organizations/branding', { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not remove logo.')
        return
      }
      toast.success('Logo removed.')
      notifyBrandingUpdated()
      await refresh()
    } catch {
      toast.error('Could not remove logo.')
    } finally {
      setClearing(false)
    }
  }, [confirm, toast, refresh])

  if (loading) {
    return (
      <div className="surface-card p-6">
        <SkeletonRows count={4} />
      </div>
    )
  }

  const displayed = pendingPreview || branding.logoDataUrl

  return (
    <div className="surface-card p-6">
      <h2 className="text-base font-semibold text-fg">Organization logo</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Replace the default tile in the sidebar and top bar with your own
        logo. Uploads are resized to 256×256 PNG and capped at 200&nbsp;KB.
      </p>

      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="shrink-0">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-32 w-32 items-center justify-center rounded-xl border border-border bg-app-subtle p-3">
              {displayed ? (
                <img
                  src={displayed}
                  alt="Organization logo preview"
                  className="max-h-full max-w-full rounded-md object-contain"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-accent text-3xl font-semibold text-accent-fg">
                  {(branding.name?.[0] || 'K').toUpperCase()}
                </div>
              )}
            </div>
            <span className="text-xs text-fg-muted">
              {pendingPreview ? 'Pending — click Save' : displayed ? 'Current logo' : 'No custom logo'}
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          {canManage ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="sr-only"
                onChange={(e) => onFileChange(e.target.files?.[0] || null)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  leftIcon={<ArrowUpTrayIcon className="h-4 w-4" />}
                  onClick={() => fileRef.current?.click()}
                  disabled={saving || clearing}
                >
                  Choose image
                </Button>
                {pendingPreview && (
                  <>
                    <Button
                      variant="primary"
                      leftIcon={<PhotoIcon className="h-4 w-4" />}
                      loading={saving}
                      onClick={save}
                    >
                      Save logo
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPendingPreview(null)
                        if (fileRef.current) fileRef.current.value = ''
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {branding.logoDataUrl && !pendingPreview && (
                  <Button
                    variant="destructive"
                    leftIcon={<TrashIcon className="h-4 w-4" />}
                    loading={clearing}
                    onClick={clear}
                  >
                    Remove logo
                  </Button>
                )}
              </div>
              <p className="text-xs text-fg-subtle">
                PNG, JPEG, WEBP, GIF, or SVG. Square images look best.
              </p>
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              Only owners and admins can change the organization logo.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
