'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/app/components/Toast'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import {
  Button,
  Input,
  Modal,
  Select,
  Textarea,
} from '@/app/components/ui'

export interface TaskFormDefaults {
  relatedFamilyId?: string
  relatedMemberId?: string
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
  email: defaults?.email ?? '',
  priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
  relatedFamilyId: defaults?.relatedFamilyId ?? '',
  relatedMemberId: defaults?.relatedMemberId ?? '',
  notes: '',
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
  const [taskForm, setTaskForm] = useState(() => buildEmptyForm(defaults))
  const [submitting, setSubmitting] = useState(false)
  const [families, setFamilies] = useState<any[]>(familiesProp ?? [])
  const [familyMembers, setFamilyMembers] = useState<{ [familyId: string]: any[] }>({})
  const hasFetchedFamiliesRef = useRef(Array.isArray(familiesProp))
  const hasFetchedMembersRef = useRef(false)
  const fetchGenRef = useRef(0)

  // Reset the form to its defaults each time the modal is reopened so that
  // the related family/member from the launching context is applied.
  useEffect(() => {
    if (open) setTaskForm(buildEmptyForm(defaults))
  }, [open, defaults])

  useEffect(() => {
    if (Array.isArray(familiesProp)) setFamilies(familiesProp)
  }, [familiesProp])

  const fetchFamilies = useCallback(async () => {
    const gen = ++fetchGenRef.current
    try {
      const data = await cachedFetch<any>('/api/families', { ttl: 30_000 })
      if (fetchGenRef.current !== gen) return
      if (data) setFamilies(data)
    } catch {
      // Best-effort.
    }
  }, [])

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

  useOrgChanged(useCallback(() => {
    fetchGenRef.current += 1
    hasFetchedFamiliesRef.current = false
    hasFetchedMembersRef.current = false
    setFamilies([])
    setFamilyMembers({})
    invalidateCache(/^\/api\/(families|family-members\/all)/)
    if (open) {
      hasFetchedFamiliesRef.current = true
      void fetchFamilies()
    }
  }, [open, fetchFamilies]))

  useEffect(() => {
    if (!open) return
    if (hasFetchedFamiliesRef.current) return
    hasFetchedFamiliesRef.current = true
    fetchFamilies()
  }, [open, fetchFamilies])

  useEffect(() => {
    if (!open) return
    if (hasFetchedMembersRef.current) return
    if (families.length === 0) return
    hasFetchedMembersRef.current = true
    fetchAllFamilyMembers()
  }, [open, families, fetchAllFamilyMembers])

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...taskForm,
          relatedFamilyId: taskForm.relatedFamilyId || undefined,
          relatedMemberId: taskForm.relatedMemberId || undefined,
        }),
      })
      if (res.ok) {
        invalidateCache(/^\/api\/tasks/)
        onClose()
        setTaskForm(buildEmptyForm(defaults))
        toast.success('Task created.')
        onCreated?.()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || 'Failed to create task.')
      }
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Task" maxWidth="max-w-lg">
      <form onSubmit={submitTask} className="space-y-4" noValidate>
        <Input
          label="Title"
          required
          placeholder="Task title"
          value={taskForm.title}
          onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
        />
        <Textarea
          label="Description"
          rows={3}
          placeholder="What needs to happen?"
          value={taskForm.description}
          onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Due Date"
            type="date"
            required
            value={taskForm.dueDate}
            onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            placeholder="email@example.com"
            hint="Email will be sent on due date."
            value={taskForm.email}
            onChange={(e) => setTaskForm({ ...taskForm, email: e.target.value })}
          />
        </div>
        <Select
          label="Priority"
          value={taskForm.priority}
          onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as any })}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Select>
        {!lockFamily && (
          <Select
            label="Related Family"
            hint="Optional."
            value={taskForm.relatedFamilyId}
            onChange={(e) =>
              setTaskForm({ ...taskForm, relatedFamilyId: e.target.value, relatedMemberId: '' })
            }
          >
            <option value="">None</option>
            {families.map((family) => (
              <option key={family._id} value={family._id}>
                {family.name}
              </option>
            ))}
          </Select>
        )}
        {taskForm.relatedFamilyId && (
          <Select
            label="Related Member"
            hint="Optional."
            value={taskForm.relatedMemberId}
            onChange={(e) => setTaskForm({ ...taskForm, relatedMemberId: e.target.value })}
          >
            <option value="">None</option>
            {familyMembers[taskForm.relatedFamilyId]?.map((member: any) => (
              <option key={member._id} value={member._id}>
                {member.firstName} {member.lastName}
              </option>
            ))}
          </Select>
        )}
        <Textarea
          label="Notes"
          rows={2}
          placeholder="Additional notes"
          value={taskForm.notes}
          onChange={(e) => setTaskForm({ ...taskForm, notes: e.target.value })}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create Task
          </Button>
        </div>
      </form>
    </Modal>
  )
}
