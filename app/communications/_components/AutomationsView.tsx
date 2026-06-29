'use client'

import { useCallback, useEffect, useState } from 'react'
import { BoltIcon, EyeIcon, PlayIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import CommunicationsNav from './CommunicationsNav'
import AutomationRecipientsModal from './AutomationRecipientsModal'
import type { EmailAutomationRuleRow, EmailTemplate } from './types'

function tf(t: ReturnType<typeof useT>, key: string, fallback: string) {
  return t(key as MessageKey, fallback)
}

type RuleType = EmailAutomationRuleRow['ruleType']

interface DraftRule {
  name: string
  enabled: boolean
  templateId: string
  ruleType: RuleType
}

const EMPTY_DRAFT: DraftRule = {
  name: '',
  enabled: false,
  templateId: '',
  ruleType: 'balance_gt_zero',
}

function formatLastRun(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export default function AutomationsView() {
  const t = useT()
  const toast = useToast()
  const [rules, setRules] = useState<EmailAutomationRuleRow[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<DraftRule>(EMPTY_DRAFT)
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [previewRule, setPreviewRule] = useState<{ id: string; name: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/email-templates')
      if (!res.ok) return
      const data = await res.json()
      const rows = (data.templates ?? data.items ?? []) as Array<EmailTemplate & { html?: string }>
      setTemplates(
        rows.map((r) => ({
          ...r,
          body: r.body ?? r.html ?? '',
        })),
      )
    } catch {
      /* ignore */
    }
  }, [])

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/email-automation-rules')
      if (!res.ok) throw new Error('Failed to load rules')
      const data = await res.json()
      setRules((data.items ?? data.rules ?? []) as EmailAutomationRuleRow[])
    } catch {
      toast.error(tf(t, 'communications.automations.loadError', 'Could not load automation rules.'))
      setRules([])
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void loadTemplates()
    void loadRules()
  }, [loadTemplates, loadRules])

  useOrgChanged(() => {
    void loadRules()
    void loadTemplates()
  })

  const createRule = async () => {
    if (!draft.name.trim() || !draft.templateId) {
      toast.error(
        tf(t, 'communications.automations.missingFields', 'Name and template are required.'),
      )
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/email-automation-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          enabled: draft.enabled,
          templateId: draft.templateId,
          ruleType: draft.ruleType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Create failed')
      toast.success(tf(t, 'communications.automations.created', 'Automation rule created.'))
      setDraft(EMPTY_DRAFT)
      void loadRules()
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf(t, 'communications.automations.createError', 'Could not create rule.'),
      )
    } finally {
      setCreating(false)
    }
  }

  const updateRule = async (id: string, patch: Partial<EmailAutomationRuleRow>) => {
    setSavingId(id)
    try {
      const res = await fetch(`/api/email-automation-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Update failed')
      setRules((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)))
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf(t, 'communications.automations.updateError', 'Could not update rule.'),
      )
    } finally {
      setSavingId(null)
    }
  }

  const deleteRule = async (id: string, name: string) => {
    const ok = window.confirm(
      tf(t, 'communications.automations.deleteConfirm', 'Delete rule "{name}"?').replace(
        '{name}',
        name,
      ),
    )
    if (!ok) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/email-automation-rules/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      toast.success(tf(t, 'communications.automations.deleted', 'Rule deleted.'))
      setRules((prev) => prev.filter((r) => r._id !== id))
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf(t, 'communications.automations.deleteError', 'Could not delete rule.'),
      )
    } finally {
      setDeletingId(null)
    }
  }

  const runNow = async (id: string) => {
    setRunningId(id)
    try {
      const res = await fetch(`/api/email-automation-rules/${id}/run-now`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Run failed')
      const sent = data.sent ?? data.emailsSent ?? 0
      toast.success(
        tf(t, 'communications.automations.runSuccess', 'Sent {count} emails.').replace(
          '{count}',
          String(sent),
        ),
      )
      void loadRules()
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf(t, 'communications.automations.runError', 'Could not run rule.'),
      )
    } finally {
      setRunningId(null)
    }
  }

  const ruleTypeLabel = (ruleType: RuleType) => {
    if (ruleType === 'balance_gt_zero') {
      return tf(t, 'communications.automations.ruleType.balance', 'Balance greater than zero')
    }
    return tf(t, 'communications.automations.ruleType.event', 'Lifecycle event within 30 days')
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={tf(t, 'communications.automations.title', 'Email automations')}
          subtitle={tf(
            t,
            'communications.automations.subtitle',
            'Automatically email families when a rule matches.',
          )}
        />

        <CommunicationsNav />

        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-medium text-fg">
            {tf(t, 'communications.automations.createTitle', 'New automation rule')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={tf(t, 'communications.automations.field.name', 'Rule name')}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={tf(
                t,
                'communications.automations.field.namePlaceholder',
                'Monthly balance reminder',
              )}
            />
            <Select
              label={tf(t, 'communications.automations.field.template', 'Email template')}
              value={draft.templateId}
              onChange={(e) => setDraft((d) => ({ ...d, templateId: e.target.value }))}
            >
              <option value="">
                {tf(t, 'communications.template.none', '— Select a template —')}
              </option>
              {templates.map((tpl) => (
                <option key={tpl._id} value={tpl._id}>
                  {tpl.name}
                </option>
              ))}
            </Select>
            <Select
              label={tf(t, 'communications.automations.field.ruleType', 'Rule type')}
              value={draft.ruleType}
              onChange={(e) => setDraft((d) => ({ ...d, ruleType: e.target.value as RuleType }))}
            >
              <option value="balance_gt_zero">{ruleTypeLabel('balance_gt_zero')}</option>
              <option value="event_within_30_days">{ruleTypeLabel('event_within_30_days')}</option>
            </Select>
            <label className="flex items-center gap-2 text-sm text-fg self-end pb-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                className="rounded border-border"
              />
              {tf(t, 'communications.automations.field.enabled', 'Enabled')}
            </label>
          </div>
          <Button
            type="button"
            loading={creating}
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => void createRule()}
          >
            {tf(t, 'communications.automations.create', 'Create rule')}
          </Button>
        </Card>

        {loading ? (
          <Card>
            <SkeletonRows count={4} />
          </Card>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<BoltIcon className="h-10 w-10" />}
            title={tf(t, 'communications.automations.empty', 'No automation rules yet')}
            description={tf(
              t,
              'communications.automations.emptyHint',
              'Create a rule above to drip emails on a schedule.',
            )}
          />
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => {
              const templateName =
                rule.templateName ??
                templates.find((tpl) => tpl._id === rule.templateId)?.name ??
                '—'
              return (
                <Card key={rule._id} compact className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-fg">{rule.name}</h3>
                        <Badge size="sm" variant={rule.enabled ? 'success' : 'default'}>
                          {rule.enabled
                            ? tf(t, 'communications.automations.status.enabled', 'Enabled')
                            : tf(t, 'communications.automations.status.disabled', 'Disabled')}
                        </Badge>
                      </div>
                      <p className="text-sm text-fg-muted">
                        {ruleTypeLabel(rule.ruleType)} · {templateName}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {tf(t, 'communications.automations.lastRun', 'Last run')}:{' '}
                        {formatLastRun(rule.lastRunAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          disabled={savingId === rule._id}
                          onChange={(e) => void updateRule(rule._id, { enabled: e.target.checked })}
                          className="rounded border-border"
                        />
                        {tf(t, 'communications.automations.field.enabled', 'Enabled')}
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        leftIcon={<EyeIcon className="h-4 w-4" />}
                        onClick={() => setPreviewRule({ id: rule._id, name: rule.name })}
                      >
                        {tf(
                          t,
                          'communications.automations.previewRecipients',
                          'Preview recipients',
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={runningId === rule._id}
                        leftIcon={<PlayIcon className="h-4 w-4" />}
                        onClick={() => void runNow(rule._id)}
                      >
                        {tf(t, 'communications.automations.runNow', 'Run now')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={deletingId === rule._id}
                        leftIcon={<TrashIcon className="h-4 w-4" />}
                        onClick={() => void deleteRule(rule._id, rule.name)}
                      >
                        {tf(t, 'communications.automations.delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <AutomationRecipientsModal
        open={previewRule != null}
        ruleId={previewRule?.id ?? null}
        ruleName={previewRule?.name ?? ''}
        onClose={() => setPreviewRule(null)}
      />
    </div>
  )
}
