'use client'

import { useCallback, useEffect, useState } from 'react'
import { TrashIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SkeletonRows,
  Textarea,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import CommunicationsNav from './CommunicationsNav'
import type { EmailTemplate } from './types'

function tf(t: ReturnType<typeof useT>, key: string, fallback: string) {
  return t(key as MessageKey, fallback)
}

type EditableTemplate = EmailTemplate & { html: string; dirty?: boolean; saving?: boolean }

function normalizeTemplate(row: Record<string, unknown>): EditableTemplate {
  const html = String(row.html ?? row.body ?? '')
  return {
    _id: String(row._id),
    name: String(row.name ?? ''),
    subject: String(row.subject ?? ''),
    body: html,
    html,
  }
}

export default function TemplatesView() {
  const t = useT()
  const toast = useToast()
  const [templates, setTemplates] = useState<EditableTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/email-templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      const rows = (data.templates ?? data.items ?? []) as Record<string, unknown>[]
      setTemplates(rows.map(normalizeTemplate))
    } catch {
      toast.error(tf(t, 'communications.template.loadError', 'Failed to load templates'))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  useOrgChanged(() => {
    void loadTemplates()
  })

  const updateLocal = (id: string, patch: Partial<EditableTemplate>) => {
    setTemplates((prev) =>
      prev.map((tpl) => (tpl._id === id ? { ...tpl, ...patch, dirty: patch.dirty ?? true } : tpl)),
    )
  }

  const saveTemplate = async (id: string) => {
    const tpl = templates.find((x) => x._id === id)
    if (!tpl) return
    if (!tpl.subject.trim() || !tpl.html.trim()) {
      toast.error(t('communications.error.missingFields'))
      return
    }

    updateLocal(id, { saving: true })
    try {
      const res = await fetch(`/api/email-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: tpl.subject.trim(), html: tpl.html }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      toast.success(tf(t, 'communications.template.updated', 'Template saved'))
      updateLocal(id, { dirty: false, saving: false })
    } catch (err: unknown) {
      updateLocal(id, { saving: false })
      toast.error(err instanceof Error ? err.message : t('communications.template.error'))
    }
  }

  const deleteTemplate = async (id: string, name: string) => {
    const ok = window.confirm(
      tf(t, 'communications.template.deleteConfirm', 'Delete template "{name}"?').replace(
        '{name}',
        name,
      ),
    )
    if (!ok) return
    try {
      const res = await fetch(`/api/email-templates/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      toast.success(tf(t, 'communications.template.deleted', 'Template deleted'))
      setTemplates((prev) => prev.filter((x) => x._id !== id))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.template.error'))
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={tf(t, 'communications.templates.title', 'Email templates')}
          subtitle={tf(
            t,
            'communications.templates.subtitle',
            'Manage reusable subject lines and message bodies.',
          )}
        />

        <CommunicationsNav />

        {loading ? (
          <Card>
            <SkeletonRows count={4} />
          </Card>
        ) : templates.length === 0 ? (
          <EmptyState
            title={tf(t, 'communications.templates.empty', 'No templates yet')}
            description={tf(
              t,
              'communications.templates.emptyHint',
              'Save a template from the compose screen, or create one here later.',
            )}
            cta={{
              label: tf(t, 'communications.templates.goCompose', 'Go to compose'),
              href: '/communications',
            }}
          />
        ) : (
          <div className="space-y-4">
            {templates.map((tpl) => (
              <Card key={tpl._id} className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-fg">{tpl.name}</p>
                  <button
                    type="button"
                    onClick={() => void deleteTemplate(tpl._id, tpl.name)}
                    className="text-fg-muted hover:text-danger shrink-0"
                    aria-label={tf(t, 'communications.template.delete', 'Delete template')}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <Input
                  label={t('communications.field.subject')}
                  value={tpl.subject}
                  onChange={(e) => updateLocal(tpl._id, { subject: e.target.value })}
                />
                <Textarea
                  label={t('communications.field.body')}
                  rows={6}
                  value={tpl.html}
                  onChange={(e) =>
                    updateLocal(tpl._id, { html: e.target.value, body: e.target.value })
                  }
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    loading={tpl.saving}
                    disabled={!tpl.dirty}
                    onClick={() => void saveTemplate(tpl._id)}
                  >
                    {tf(t, 'communications.template.saveChanges', 'Save changes')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
