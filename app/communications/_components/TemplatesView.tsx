'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClockIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonRows,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import CommunicationsNav from './CommunicationsNav'
import EmailComposeEditor from './EmailComposeEditor'
import {
  apiErrorMessage,
  bodyToEmailHtml,
  bodyToPlainText,
  composeBodyIsEmpty,
  emailHtmlToEditorHtml,
} from './email-utils'
import type { EmailTemplate, EmailTemplateCategory } from './types'

const TEMPLATE_CATEGORIES: EmailTemplateCategory[] = [
  'general',
  'billing',
  'events',
  'announcements',
]

function tf(t: ReturnType<typeof useT>, key: string, fallback: string) {
  return t(key as MessageKey, fallback)
}

type EditableTemplate = EmailTemplate & { html: string; dirty?: boolean; saving?: boolean }

type TemplateVersion = {
  _id: string
  version: number
  subject: string
  html: string
  text: string | null
  createdAt: string
}

function formatVersionDate(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

function normalizeTemplate(row: Record<string, unknown>): EditableTemplate {
  const stored = String(row.html ?? row.body ?? '')
  const html = emailHtmlToEditorHtml(stored)
  return {
    _id: String(row._id),
    name: String(row.name ?? ''),
    subject: String(row.subject ?? ''),
    body: html,
    html,
    category: (row.category as EmailTemplateCategory) || 'general',
  }
}

function categoryLabel(category: string, t: ReturnType<typeof useT>) {
  const key = `communications.template.category.${category}` as MessageKey
  const fallbacks: Record<string, string> = {
    general: 'General',
    billing: 'Billing',
    events: 'Events',
    announcements: 'Announcements',
  }
  return t(key, fallbacks[category] ?? category)
}

export default function TemplatesView() {
  const t = useT()
  const toast = useToast()
  const [templates, setTemplates] = useState<EditableTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [newCategory, setNewCategory] = useState<EmailTemplateCategory>('general')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyTemplateId, setHistoryTemplateId] = useState<string | null>(null)
  const [historyTemplateName, setHistoryTemplateName] = useState('')
  const [historyVersions, setHistoryVersions] = useState<TemplateVersion[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null)

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
    if (!tpl.subject.trim() || composeBodyIsEmpty(tpl.html)) {
      toast.error(t('communications.error.missingFields'))
      return
    }

    updateLocal(id, { saving: true })
    try {
      const res = await fetch(`/api/email-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: tpl.subject.trim(),
          html: bodyToEmailHtml(tpl.html),
          text: bodyToPlainText(tpl.html),
          category: tpl.category || 'general',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to save'))
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

  const openHistory = async (id: string, name: string) => {
    setHistoryTemplateId(id)
    setHistoryTemplateName(name)
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryVersions([])
    try {
      const res = await fetch(`/api/email-templates/${id}/versions`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to load versions'))
      setHistoryVersions((data.versions ?? []) as TemplateVersion[])
    } catch {
      toast.error(
        tf(t, 'communications.template.historyLoadError', 'Could not load version history.'),
      )
    } finally {
      setHistoryLoading(false)
    }
  }

  const closeHistory = () => {
    setHistoryOpen(false)
    setHistoryTemplateId(null)
    setHistoryTemplateName('')
    setHistoryVersions([])
    setRestoringVersionId(null)
  }

  const restoreVersion = async (version: TemplateVersion) => {
    if (!historyTemplateId) return
    const ok = window.confirm(
      tf(
        t,
        'communications.template.restoreConfirm',
        'Restore version {version}? Current content will be replaced.',
      ).replace('{version}', String(version.version)),
    )
    if (!ok) return

    setRestoringVersionId(version._id)
    try {
      const res = await fetch(`/api/email-templates/${historyTemplateId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: version._id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to restore'))

      const html = emailHtmlToEditorHtml(String(data.html ?? ''))
      setTemplates((prev) =>
        prev.map((tpl) =>
          tpl._id === historyTemplateId
            ? {
                ...tpl,
                subject: String(data.subject ?? ''),
                html,
                body: html,
                dirty: false,
              }
            : tpl,
        ),
      )
      toast.success(
        tf(
          t,
          'communications.template.restored',
          'Template restored from version {version}.',
        ).replace('{version}', String(version.version)),
      )
      closeHistory()
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf(t, 'communications.template.restoreError', 'Could not restore template version.'),
      )
    } finally {
      setRestoringVersionId(null)
    }
  }

  const filteredTemplates = categoryFilter
    ? templates.filter((tpl) => (tpl.category || 'general') === categoryFilter)
    : templates

  const createTemplate = async () => {
    const name = window.prompt(tf(t, 'communications.template.namePrompt', 'Template name'))
    if (!name?.trim()) return
    try {
      const res = await fetch('/api/email-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          subject: tf(t, 'communications.template.newSubject', 'Subject line'),
          html: '<p></p>',
          category: newCategory,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to create template'))
      toast.success(tf(t, 'communications.template.saved', 'Template saved'))
      void loadTemplates()
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

        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={tf(t, 'communications.template.filterCategory', 'Category')}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="min-w-[160px]"
          >
            <option value="">
              {tf(t, 'communications.template.allCategories', 'All categories')}
            </option>
            {TEMPLATE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {categoryLabel(cat, t)}
              </option>
            ))}
          </Select>
          <Select
            label={tf(t, 'communications.template.newCategory', 'New template category')}
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as EmailTemplateCategory)}
            className="min-w-[160px]"
          >
            {TEMPLATE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {categoryLabel(cat, t)}
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" onClick={() => void createTemplate()}>
            {tf(t, 'communications.template.create', 'Create template')}
          </Button>
        </div>

        {loading ? (
          <Card>
            <SkeletonRows count={4} />
          </Card>
        ) : filteredTemplates.length === 0 ? (
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
            {filteredTemplates.map((tpl) => (
              <Card key={tpl._id} className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{tpl.name}</p>
                    <Badge size="sm" variant="default" className="mt-1">
                      {categoryLabel(tpl.category || 'general', t)}
                    </Badge>
                  </div>
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
                <Select
                  label={tf(t, 'communications.template.categoryLabel', 'Category')}
                  value={tpl.category || 'general'}
                  onChange={(e) =>
                    updateLocal(tpl._id, { category: e.target.value as EmailTemplateCategory })
                  }
                >
                  {TEMPLATE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {categoryLabel(cat, t)}
                    </option>
                  ))}
                </Select>
                <EmailComposeEditor
                  label={t('communications.field.body')}
                  rows={6}
                  value={tpl.html}
                  onChange={(html) => updateLocal(tpl._id, { html, body: html })}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void openHistory(tpl._id, tpl.name)}
                  >
                    <ClockIcon className="h-4 w-4 mr-1.5" aria-hidden />
                    {tf(t, 'communications.template.history', 'History')}
                  </Button>
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

      <Modal
        open={historyOpen}
        onClose={closeHistory}
        title={tf(t, 'communications.template.historyTitle', 'Version history')}
        description={historyTemplateName}
        maxWidth="max-w-xl"
        footer={
          <Button type="button" variant="secondary" onClick={closeHistory}>
            {t('common.close', 'Close')}
          </Button>
        }
      >
        {historyLoading ? (
          <SkeletonRows count={3} />
        ) : historyVersions.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {tf(
              t,
              'communications.template.historyEmpty',
              'No saved versions yet. Versions are created when you save changes.',
            )}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {historyVersions.map((version) => (
              <li key={version._id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {tf(t, 'communications.template.historyVersion', 'Version {version}').replace(
                      '{version}',
                      String(version.version),
                    )}
                  </p>
                  <p className="text-xs text-fg-muted mt-0.5">
                    {formatVersionDate(version.createdAt)}
                  </p>
                  <p className="text-sm text-fg-muted mt-1 truncate">{version.subject}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={restoringVersionId === version._id}
                  disabled={restoringVersionId !== null && restoringVersionId !== version._id}
                  onClick={() => void restoreVersion(version)}
                >
                  {tf(t, 'communications.template.restore', 'Restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}
