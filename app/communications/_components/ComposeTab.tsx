'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkIcon,
  ClockIcon,
  DocumentTextIcon,
  EyeIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { useToast, useConfirm } from '@/app/components/Toast'
import { Alert, Button, Card, Input, Select } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import EmailComposeEditor from './EmailComposeEditor'
import EmailPreviewModal from './EmailPreviewModal'
import RecipientList from './RecipientList'
import {
  filterFamiliesBySegment,
  isSelectableFamily,
  type RecipientSegment,
} from './recipient-segments'
import {
  apiErrorMessage,
  attachmentsForApi,
  defaultTaxReceiptYear,
  markdownToHtml,
  markdownToPlainText,
  taxReceiptYearOptions,
} from './email-utils'
import { tomorrowMorningLocal, useEmailQuota } from './useEmailQuota'
import type { EmailAttachment, EmailDraft, EmailTemplate, FamilyOption } from './types'

const MAX_ATTACHMENTS = 3
const MAX_FILE_BYTES = 5 * 1024 * 1024
const DRAFT_DEBOUNCE_MS = 2000
const QUOTA_THRESHOLD = 50

interface ComposeTabProps {
  families: FamilyOption[]
  loadingFamilies: boolean
  hasBalanceData?: boolean
  initialFamilyId?: string | null
  onSent: (result: { sent: number; failed: number; campaignId?: string }) => void
  onJobStarted?: (info: { jobId: string; totalFamilies: number; campaignId?: string }) => void
}

export default function ComposeTab({
  families,
  loadingFamilies,
  hasBalanceData = true,
  initialFamilyId,
  onSent,
  onJobStarted,
}: ComposeTabProps) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()

  const [subject, setSubject] = useState('')
  const [subjectB, setSubjectB] = useState('')
  const [body, setBody] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [attachments, setAttachments] = useState<EmailAttachment[]>([])
  const [taxReceiptYear, setTaxReceiptYear] = useState(defaultTaxReceiptYear)
  const taxYearOptions = useMemo(() => taxReceiptYearOptions(), [])
  const [scheduledAt, setScheduledAt] = useState('')
  const [sending, setSending] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [attachingStatement, setAttachingStatement] = useState(false)
  const [attachingTaxReceipt, setAttachingTaxReceipt] = useState(false)
  const [recipientSegment, setRecipientSegment] = useState<RecipientSegment>('all')
  const { quota } = useEmailQuota()

  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [drafts, setDrafts] = useState<EmailDraft[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [selectedDraftId, setSelectedDraftId] = useState('')
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null)

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipAutoSaveRef = useRef(false)

  const selectableFamilies = families.filter(isSelectableFamily)

  const selectedFamilies = selectableFamilies.filter((f) => selectedIds.has(f._id))
  const deliverabilityWarnings = selectedFamilies.filter((f) => f.emailDeliverabilityWarning)
  const singleSelectedFamilyId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : undefined

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

  const loadDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/email-drafts')
      if (!res.ok) return
      const data = await res.json()
      setDrafts((data.items ?? []) as EmailDraft[])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
    void loadDrafts()
  }, [loadTemplates, loadDrafts])

  const toggleFamily = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    const inSegment = filterFamiliesBySegment(families, recipientSegment).filter(isSelectableFamily)
    setSelectedIds(new Set(inSegment.map((f) => f._id)))
  }

  useEffect(() => {
    if (!initialFamilyId || loadingFamilies) return
    const match = families.find((f) => f._id === initialFamilyId)
    if (match && isSelectableFamily(match)) {
      setSelectedIds(new Set([initialFamilyId]))
      setRecipientSegment('all')
    }
  }, [initialFamilyId, loadingFamilies, families])

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId)
    if (!templateId) return
    const tpl = templates.find((x) => x._id === templateId)
    if (!tpl) return
    setSubject(tpl.subject)
    setBody(tpl.body)
  }

  const applyDraft = (draftId: string) => {
    setSelectedDraftId(draftId)
    if (!draftId) return
    const draft = drafts.find((x) => x._id === draftId)
    if (!draft) return
    skipAutoSaveRef.current = true
    setCurrentDraftId(draft._id)
    setSubject(draft.subject)
    setBody(draft.body)
    if (draft.familyIds?.length) setSelectedIds(new Set(draft.familyIds))
  }

  const saveAsTemplate = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error(t('communications.error.missingFields'))
      return
    }
    const name = window.prompt(t('communications.template.namePrompt'))
    if (!name?.trim()) return
    try {
      const res = await fetch('/api/email-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), subject: subject.trim(), body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(t('communications.template.saved'))
      void loadTemplates()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.template.error'))
    }
  }

  const saveDraft = useCallback(
    async (silent = false) => {
      if (!subject.trim() && !body.trim()) return
      setSavingDraft(true)
      try {
        const payload = {
          subject: subject.trim(),
          body,
          familyIds: Array.from(selectedIds),
        }
        const url = currentDraftId ? `/api/email-drafts/${currentDraftId}` : '/api/email-drafts'
        const method = currentDraftId ? 'PATCH' : 'POST'
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Failed')
        const id = (data._id ?? data.draft?._id ?? currentDraftId) as string | undefined
        if (id) setCurrentDraftId(id)
        if (!silent) toast.success(t('communications.draft.saved'))
        void loadDrafts()
      } catch (err: unknown) {
        if (!silent)
          toast.error(err instanceof Error ? err.message : t('communications.draft.error'))
      } finally {
        setSavingDraft(false)
      }
    },
    [subject, body, selectedIds, currentDraftId, toast, t, loadDrafts],
  )

  useEffect(() => {
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false
      return
    }
    if (!subject.trim() && !body.trim()) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      void saveDraft(true)
    }, DRAFT_DEBOUNCE_MS)
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    }
  }, [subject, body, selectedIds, saveDraft])

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(t('communications.attachments.maxFiles'))
      return
    }
    const toAdd = Array.from(files).slice(0, remaining)
    const next: EmailAttachment[] = [...attachments]

    for (const file of toAdd) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(t('communications.attachments.tooLarge').replace('{name}', file.name))
        continue
      }
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const base64 = result.includes(',') ? result.split(',')[1] : result
          resolve(base64)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      next.push({
        filename: file.name,
        content,
        contentType: file.type || 'application/octet-stream',
      })
    }
    setAttachments(next)
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const attachStatement = async () => {
    if (!singleSelectedFamilyId) {
      toast.error(t('communications.statement.selectOne'))
      return
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(t('communications.attachments.maxFiles'))
      return
    }
    setAttachingStatement(true)
    try {
      const res = await fetch('/api/emails/attach-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: singleSelectedFamilyId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to attach statement'))
      const filename = String(data.filename ?? 'statement.pdf')
      const content = String(data.contentBase64 ?? data.content ?? '')
      if (!content) throw new Error('No PDF returned')
      setAttachments((prev) => [
        ...prev,
        {
          filename,
          content,
          contentType: 'application/pdf',
        },
      ])
      toast.success(t('communications.statement.attached'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.statement.error'))
    } finally {
      setAttachingStatement(false)
    }
  }

  const attachTaxReceipt = async () => {
    if (!singleSelectedFamilyId) {
      toast.error(t('communications.taxReceipt.selectOne'))
      return
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(t('communications.attachments.maxFiles'))
      return
    }
    setAttachingTaxReceipt(true)
    try {
      const res = await fetch('/api/emails/attach-tax-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: singleSelectedFamilyId, year: taxReceiptYear }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Failed to attach tax receipt'))
      const filename = String(data.filename ?? 'tax-receipt.pdf')
      const content = String(data.contentBase64 ?? data.content ?? '')
      if (!content) throw new Error('No PDF returned')
      setAttachments((prev) => [
        ...prev,
        {
          filename,
          content,
          contentType: 'application/pdf',
        },
      ])
      toast.success(t('communications.taxReceipt.attached'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.taxReceipt.error'))
    } finally {
      setAttachingTaxReceipt(false)
    }
  }

  const buildPayload = () => {
    const html = markdownToHtml(body)
    const text = markdownToPlainText(body)
    const payload: Record<string, unknown> = {
      familyIds: Array.from(selectedIds),
      subject: subject.trim(),
      html,
      text,
      attachments: attachments.length > 0 ? attachmentsForApi(attachments) : undefined,
    }
    if (subjectB.trim()) payload.subjectB = subjectB.trim()
    return payload
  }

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error(t('communications.error.missingFields'))
      return
    }
    if (selectedIds.size === 0) {
      toast.error(t('communications.error.noRecipients'))
      return
    }

    if (deliverabilityWarnings.length > 0) {
      const names = deliverabilityWarnings
        .slice(0, 3)
        .map((f) => f.name)
        .join(', ')
      const extra =
        deliverabilityWarnings.length > 3
          ? t('communications.deliverability.andMore').replace(
              '{count}',
              String(deliverabilityWarnings.length - 3),
            )
          : ''
      const proceed = await confirm({
        title: t('communications.deliverability.title'),
        message: t('communications.deliverability.message')
          .replace('{names}', `${names}${extra}`)
          .replace('{count}', String(deliverabilityWarnings.length)),
        confirmLabel: t('communications.deliverability.sendAnyway'),
        cancelLabel: t('communications.deliverability.cancel'),
      })
      if (!proceed) return
    }

    setSending(true)
    try {
      const payload = buildPayload()

      if (scheduledAt) {
        const res = await fetch('/api/scheduled-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, scheduledAt: new Date(scheduledAt).toISOString() }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(apiErrorMessage(data, 'Schedule failed'))
        toast.success(t('communications.schedule.success'))
        setSubject('')
        setSubjectB('')
        setBody('')
        setSelectedIds(new Set())
        setAttachments([])
        setScheduledAt('')
        setCurrentDraftId(null)
        onSent({ sent: selectedIds.size, failed: 0 })
        return
      }

      const res = await fetch('/api/emails/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Send failed'))

      const jobId = data.jobId as string | undefined
      if (jobId) {
        toast.success(
          t('communications.job.queued').replace(
            '{count}',
            String(data.totalFamilies ?? selectedIds.size),
          ),
        )
        setSubject('')
        setSubjectB('')
        setBody('')
        setSelectedIds(new Set())
        setAttachments([])
        setScheduledAt('')
        setCurrentDraftId(null)
        onJobStarted?.({
          jobId,
          totalFamilies: (data.totalFamilies as number) ?? selectedIds.size,
          campaignId: data.campaignId as string | undefined,
        })
        return
      }

      const sent = data.sent ?? 0
      const failed = data.failed ?? 0
      const campaignId = data.campaignId as string | undefined

      if (failed > 0 && Array.isArray(data.errors) && data.errors.length > 0) {
        toast.error(data.errors.slice(0, 2).join(' · '))
      }
      if (sent > 0) {
        toast.success(
          t('communications.sendResult')
            .replace('{sent}', String(sent))
            .replace('{failed}', String(failed)),
        )
      }

      setSubject('')
      setSubjectB('')
      setBody('')
      setSelectedIds(new Set())
      setAttachments([])
      setScheduledAt('')
      setCurrentDraftId(null)
      onSent({ sent, failed, campaignId })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.error.send'))
    } finally {
      setSending(false)
    }
  }

  const sampleFamilyName =
    selectableFamilies.find((f) => selectedIds.has(f._id))?.name ??
    selectableFamilies[0]?.name ??
    'Sample Family'

  const remainingQuota = quota?.remaining
  const overQuota =
    remainingQuota != null && selectedIds.size > 0 && selectedIds.size > remainingQuota
  const scheduleSuggested = overQuota && !scheduledAt

  const applyTomorrowSchedule = () => {
    setScheduledAt(tomorrowMorningLocal())
  }

  return (
    <>
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t('communications.template.load')}
            value={selectedTemplateId}
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="">{t('communications.template.none')}</option>
            {templates.map((tpl) => (
              <option key={tpl._id} value={tpl._id}>
                {tpl.name}
              </option>
            ))}
          </Select>
          <Select
            label={t('communications.draft.load')}
            value={selectedDraftId}
            onChange={(e) => applyDraft(e.target.value)}
          >
            <option value="">{t('communications.draft.none')}</option>
            {drafts.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name || d.subject || t('communications.draft.unnamed')}
              </option>
            ))}
          </Select>
        </div>

        <Input
          label={t('communications.field.subject')}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('communications.field.subjectPlaceholder')}
        />

        <Input
          label={t('communications.field.subjectB' as MessageKey, 'Subject B (A/B test)')}
          hint={t(
            'communications.field.subjectBHint' as MessageKey,
            'Optional. Half of recipients get this subject line instead.',
          )}
          value={subjectB}
          onChange={(e) => setSubjectB(e.target.value)}
          placeholder={t(
            'communications.field.subjectBPlaceholder' as MessageKey,
            'Alternate subject line',
          )}
        />

        <EmailComposeEditor
          label={t('communications.field.body')}
          value={body}
          onChange={setBody}
          placeholder={t('communications.field.bodyPlaceholder')}
          hint={t('communications.field.bodyHint')}
        />

        <RecipientList
          families={families}
          loading={loadingFamilies}
          selectedIds={selectedIds}
          segment={recipientSegment}
          onSegmentChange={setRecipientSegment}
          hasBalanceData={hasBalanceData}
          onToggle={toggleFamily}
          onSelectAll={selectAll}
        />

        {deliverabilityWarnings.length > 0 && (
          <Alert variant="warning" title={t('communications.deliverability.title')}>
            {t('communications.deliverability.banner').replace(
              '{count}',
              String(deliverabilityWarnings.length),
            )}
          </Alert>
        )}

        <div>
          <label className="text-sm font-medium text-fg">
            {t('communications.attachments.label')}
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg hover:bg-app-subtle">
              <PaperClipIcon className="h-4 w-4 text-fg-muted" />
              {t('communications.attachments.add')}
              <input
                type="file"
                className="sr-only"
                multiple
                disabled={attachments.length >= MAX_ATTACHMENTS}
                onChange={(e) => {
                  void handleFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={attachingStatement}
              disabled={!singleSelectedFamilyId || attachments.length >= MAX_ATTACHMENTS}
              leftIcon={<DocumentTextIcon className="h-4 w-4" />}
              onClick={() => void attachStatement()}
            >
              {t('communications.statement.attach')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={attachingTaxReceipt}
              disabled={!singleSelectedFamilyId || attachments.length >= MAX_ATTACHMENTS}
              leftIcon={<DocumentTextIcon className="h-4 w-4" />}
              onClick={() => void attachTaxReceipt()}
            >
              {t('communications.taxReceipt.attach')}
            </Button>
            <Select
              aria-label={t('communications.taxReceipt.year')}
              value={String(taxReceiptYear)}
              onChange={(e) => setTaxReceiptYear(Number(e.target.value))}
              className="w-auto min-w-[5.5rem]"
              disabled={!singleSelectedFamilyId}
            >
              {taxYearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <span className="text-xs text-fg-muted">{t('communications.attachments.hint')}</span>
          </div>
          {!singleSelectedFamilyId && selectedIds.size > 1 && (
            <p className="mt-1 text-xs text-fg-muted">
              {t('communications.statement.selectOneHint')}
            </p>
          )}
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((a, i) => (
                <li key={`${a.filename}-${i}`} className="flex items-center gap-2 text-sm text-fg">
                  <span className="truncate flex-1">{a.filename}</span>
                  {a.contentType === 'application/pdf' && (
                    <a
                      href={`data:application/pdf;base64,${a.content}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline shrink-0"
                    >
                      {t('communications.attachments.preview')}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="text-fg-muted hover:text-danger"
                    aria-label={t('communications.attachments.remove')}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Input
          type="datetime-local"
          label={t('communications.schedule.label')}
          hint={t('communications.schedule.hint')}
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />

        {scheduleSuggested && (
          <Alert variant="warning" title={t('communications.quota.exceededTitle')}>
            <p className="text-sm">
              {t('communications.quota.exceededMessage')
                .replace('{selected}', String(selectedIds.size))
                .replace('{remaining}', String(remainingQuota ?? 0))}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              leftIcon={<ClockIcon className="h-4 w-4" />}
              onClick={applyTomorrowSchedule}
            >
              {t('communications.quota.scheduleTomorrow')}
            </Button>
          </Alert>
        )}

        {selectedIds.size > QUOTA_THRESHOLD && (
          <Alert variant="warning" title={t('communications.quota.title')}>
            {t('communications.quota.message').replace('{count}', String(selectedIds.size))}
          </Alert>
        )}

        <p className="text-xs text-fg-muted">{t('communications.trackingNotice')}</p>

        <div className="flex flex-wrap items-center gap-2">
          {quota != null && (
            <p
              className={`text-xs tabular mr-auto ${overQuota ? 'text-danger font-medium' : 'text-fg-muted'}`}
            >
              {t('communications.quota.daily')
                .replace('{sent}', String(quota.sent))
                .replace('{limit}', String(quota.limit))}
              {overQuota &&
                ` · ${t('communications.quota.overSelected').replace('{count}', String(selectedIds.size - (remainingQuota ?? 0)))}`}
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            leftIcon={<EyeIcon className="h-4 w-4" />}
            onClick={() => setShowPreview(true)}
          >
            {t('communications.preview.button')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={savingDraft}
            leftIcon={<BookmarkIcon className="h-4 w-4" />}
            onClick={() => void saveDraft(false)}
          >
            {t('communications.draft.save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            leftIcon={<BookmarkIcon className="h-4 w-4" />}
            onClick={() => void saveAsTemplate()}
          >
            {t('communications.template.save')}
          </Button>
          <Button
            loading={sending}
            leftIcon={
              scheduledAt ? (
                <ClockIcon className="h-4 w-4" />
              ) : (
                <PaperAirplaneIcon className="h-4 w-4" />
              )
            }
            onClick={() => void send()}
          >
            {scheduledAt
              ? t('communications.schedule.button').replace('{count}', String(selectedIds.size))
              : t('communications.send').replace('{count}', String(selectedIds.size))}
          </Button>
        </div>
      </Card>

      <EmailPreviewModal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        subject={subject}
        body={body}
        sampleFamilyName={sampleFamilyName}
      />
    </>
  )
}
