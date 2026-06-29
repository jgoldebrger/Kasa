'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/app/components/Toast'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useT } from '@/lib/client/i18n'
import {
  FAMILIES_LIST_PAGE_SIZE,
  familiesListUrl,
  parseFamiliesListResponse,
} from '@/lib/client/families-list'
import { Button, Input, Modal, Select, Textarea } from '@/app/components/ui'
import { TASK_TEMPLATES, dueDateFromOffset, type TaskTemplateId } from '@/lib/tasks/templates'

interface OrgMember {
  membershipId: string
  userId: string | null
  name: string
  email: string
}

export interface TaskFormDefaults {
  relatedFamilyId?: string
  relatedMemberId?: string
  assigneeMembershipId?: string
  /** @deprecated Legacy default; prefer assigneeMembershipId */
  email?: string
}

export interface TaskFormModalProps {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  families?: any[]
  defaults?: TaskFormDefaults
  lockFamily?: boolean
}

const buildEmptyForm = (defaults?: TaskFormDefaults) => ({
  title: '',
  description: '',
  dueDate: new Date().toISOString().split('T')[0],
  assigneeMembershipId: defaults?.assigneeMembershipId ?? '',
  priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
  relatedFamilyId: defaults?.relatedFamilyId ?? '',
  relatedMemberId: defaults?.relatedMemberId ?? '',
  notes: '',
  templateId: '' as TaskTemplateId | '',
})

export default function TaskFormModal({
  open,
  onClose,
  onCreated,
  families: familiesProp,
  defaults,
  lockFamily,
}: TaskFormModalProps) {
  const toast = useToast()
  const t = useT()
  const [taskForm, setTaskForm] = useState(() => buildEmptyForm(defaults))
  const [submitting, setSubmitting] = useState(false)
  const [families, setFamilies] = useState<any[]>(familiesProp ?? [])
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([])
  const [familyMembers, setFamilyMembers] = useState<{ [familyId: string]: any[] }>({})
  const hasFetchedFamiliesRef = useRef(Array.isArray(familiesProp))
  const hasFetchedMembersRef = useRef(false)
  const hasFetchedOrgMembersRef = useRef(false)
  const fetchGenRef = useRef(0)

  useEffect(() => {
    if (open) setTaskForm(buildEmptyForm(defaults))
  }, [open, defaults])

  useEffect(() => {
    if (Array.isArray(familiesProp)) setFamilies(familiesProp)
  }, [familiesProp])

  const fetchFamilies = useCallback(async () => {
    const gen = ++fetchGenRef.current
    try {
      const data = await cachedFetch<any>(familiesListUrl(null, FAMILIES_LIST_PAGE_SIZE), {
        ttl: 30_000,
      })
      if (fetchGenRef.current !== gen) return
      const { items } = parseFamiliesListResponse(data)
      if (items.length > 0) setFamilies(items)
    } catch {
      // Best-effort.
    }
  }, [])

  const fetchOrgMembers = useCallback(async () => {
    const gen = ++fetchGenRef.current
    try {
      const data = await cachedFetch<{ members?: OrgMember[]; currentUserId?: string }>(
        '/api/org-members',
        { ttl: 30_000 },
      )
      if (fetchGenRef.current !== gen) return
      const members = data?.members ?? []
      setOrgMembers(members)
      if (!defaults?.assigneeMembershipId && data?.currentUserId && members.length > 0) {
        const self = members.find((m) => m.userId === data.currentUserId)
        if (self) {
          setTaskForm((prev) =>
            prev.assigneeMembershipId ? prev : { ...prev, assigneeMembershipId: self.membershipId },
          )
        }
      }
    } catch {
      // Best-effort.
    }
  }, [defaults?.assigneeMembershipId])

  const fetchAllFamilyMembers = useCallback(async () => {
    const gen = ++fetchGenRef.current
    try {
      const data = await cachedFetch<{ byFamily: Record<string, any[]> }>(
        '/api/family-members/all',
        { ttl: 30_000 },
      )
      if (fetchGenRef.current !== gen) return
      setFamilyMembers(data?.byFamily || {})
    } catch {
      // Silent.
    }
  }, [])

  useOrgChanged(
    useCallback(() => {
      fetchGenRef.current += 1
      hasFetchedFamiliesRef.current = false
      hasFetchedMembersRef.current = false
      hasFetchedOrgMembersRef.current = false
      setFamilies([])
      setFamilyMembers({})
      setOrgMembers([])
      invalidateCache(/^\/api\/(families|family-members\/all|org-members)/)
      if (open) {
        hasFetchedFamiliesRef.current = true
        hasFetchedOrgMembersRef.current = true
        void fetchFamilies()
        void fetchOrgMembers()
      }
    }, [open, fetchFamilies, fetchOrgMembers]),
  )

  useEffect(() => {
    if (!open) return
    if (hasFetchedFamiliesRef.current) return
    hasFetchedFamiliesRef.current = true
    fetchFamilies()
  }, [open, fetchFamilies])

  useEffect(() => {
    if (!open) return
    if (hasFetchedOrgMembersRef.current) return
    hasFetchedOrgMembersRef.current = true
    fetchOrgMembers()
  }, [open, fetchOrgMembers])

  useEffect(() => {
    if (!open) return
    if (hasFetchedMembersRef.current) return
    if (families.length === 0) return
    hasFetchedMembersRef.current = true
    fetchAllFamilyMembers()
  }, [open, families, fetchAllFamilyMembers])

  const applyTemplate = (templateId: string) => {
    if (!templateId) {
      setTaskForm((prev) => ({
        ...buildEmptyForm(defaults),
        assigneeMembershipId: prev.assigneeMembershipId,
      }))
      return
    }
    const template = TASK_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setTaskForm((prev) => ({
      ...prev,
      templateId: template.id,
      title: t(template.titleKey),
      description: t(template.descriptionKey),
      dueDate: dueDateFromOffset(template.dueDaysOffset),
      priority: template.priority,
    }))
  }

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskForm.title,
          description: taskForm.description || undefined,
          dueDate: taskForm.dueDate,
          assigneeMembershipId: taskForm.assigneeMembershipId || undefined,
          priority: taskForm.priority,
          relatedFamilyId: taskForm.relatedFamilyId || undefined,
          relatedMemberId: taskForm.relatedMemberId || undefined,
          notes: taskForm.notes || undefined,
        }),
      })
      if (res.ok) {
        invalidateCache(/^\/api\/tasks/)
        onClose()
        setTaskForm(buildEmptyForm(defaults))
        toast.success(t('tasks.form.success'))
        onCreated?.()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || t('tasks.form.error'))
      }
    } catch {
      toast.error(t('common.networkErrorShort'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('tasks.form.createTitle')} maxWidth="max-w-lg">
      <form onSubmit={submitTask} className="space-y-4" noValidate>
        <Select
          label={t('tasks.form.template')}
          hint={t('tasks.form.templateHint')}
          value={taskForm.templateId}
          onChange={(e) => applyTemplate(e.target.value)}
        >
          <option value="">{t('tasks.form.templateNone')}</option>
          {TASK_TEMPLATES.map((template) => (
            <option key={template.id} value={template.id}>
              {t(template.labelKey)}
            </option>
          ))}
        </Select>
        <Input
          label={t('tasks.form.title')}
          required
          placeholder={t('tasks.form.titlePlaceholder')}
          value={taskForm.title}
          onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
        />
        <Textarea
          label={t('tasks.form.description')}
          rows={3}
          placeholder={t('tasks.form.descriptionPlaceholder')}
          value={taskForm.description}
          onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={t('tasks.form.dueDate')}
            type="date"
            required
            value={taskForm.dueDate}
            onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
          />
          <Select
            label={t('tasks.form.assignee')}
            required
            hint={t('tasks.form.assigneeHint')}
            value={taskForm.assigneeMembershipId}
            onChange={(e) => setTaskForm({ ...taskForm, assigneeMembershipId: e.target.value })}
          >
            <option value="">{t('tasks.form.assigneePlaceholder')}</option>
            {orgMembers.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {member.name}
                {member.email ? ` (${member.email})` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Select
          label={t('tasks.form.priority')}
          value={taskForm.priority}
          onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as any })}
        >
          <option value="low">{t('tasks.priority.low')}</option>
          <option value="medium">{t('tasks.priority.medium')}</option>
          <option value="high">{t('tasks.priority.high')}</option>
          <option value="urgent">{t('tasks.priority.urgent')}</option>
        </Select>
        {!lockFamily && (
          <Select
            label={t('tasks.form.relatedFamily')}
            hint={t('tasks.form.relatedFamilyHint')}
            value={taskForm.relatedFamilyId}
            onChange={(e) =>
              setTaskForm({ ...taskForm, relatedFamilyId: e.target.value, relatedMemberId: '' })
            }
          >
            <option value="">{t('tasks.form.none')}</option>
            {families.map((family) => (
              <option key={family._id} value={family._id}>
                {family.name}
              </option>
            ))}
          </Select>
        )}
        {taskForm.relatedFamilyId && (
          <Select
            label={t('tasks.form.relatedMember')}
            hint={t('tasks.form.relatedMemberHint')}
            value={taskForm.relatedMemberId}
            onChange={(e) => setTaskForm({ ...taskForm, relatedMemberId: e.target.value })}
          >
            <option value="">{t('tasks.form.none')}</option>
            {familyMembers[taskForm.relatedFamilyId]?.map((member: any) => (
              <option key={member._id} value={member._id}>
                {member.firstName} {member.lastName}
              </option>
            ))}
          </Select>
        )}
        <Textarea
          label={t('tasks.form.notes')}
          rows={2}
          placeholder={t('tasks.form.notesPlaceholder')}
          value={taskForm.notes}
          onChange={(e) => setTaskForm({ ...taskForm, notes: e.target.value })}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('tasks.form.cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('tasks.form.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
