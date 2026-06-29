'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import {
  UserPlusIcon,
  TrashIcon,
  ClipboardIcon,
  CheckIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { useToast, useConfirm } from '@/app/components/Toast'
import { useCopyToClipboard } from '@/lib/client/useCopyToClipboard'
import ReadOnlySupportGuard from '@/app/components/ReadOnlySupportGuard'
import { useSupportModeReadOnly } from '@/lib/client/support-mode'
import {
  Button,
  DataView,
  EmptyState,
  Input,
  Select,
  SkeletonRows,
  Alert,
  type DataColumn,
} from '@/app/components/ui'

interface Member {
  membershipId: string
  userId: string | null
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
}

interface PendingInvite {
  id: string
  email: string
  role: 'owner' | 'admin' | 'member'
  invitedAt: string
  expiresAt: string
}

const ROLE_BADGE: Record<string, string> = {
  owner:
    'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30',
  admin: 'bg-accent/10 text-accent border-accent/20',
  member: 'bg-fg/5 text-fg border-border',
}

interface MembersPanelProps {
  /** Called with the current user's role once it's known, so the parent can
   *  decide whether to show owner-only UI elsewhere. */
  onRoleResolved?: (role: 'owner' | 'admin' | 'member') => void
}

/**
 * Members management UI, used inside the Settings page as a tab.
 * Previously lived at `/settings/members`; that route is now a redirect.
 */
export default function MembersPanel({ onRoleResolved }: MembersPanelProps = {}) {
  const toast = useToast()
  const confirm = useConfirm()
  const { copy, copied } = useCopyToClipboard()
  const { readOnly: supportReadOnly } = useSupportModeReadOnly()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'admin' | 'member'>('member')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'owner'>('member')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin'
  const { begin, invalidate, isStale } = useRequestGeneration()

  const refresh = useCallback(async () => {
    const gen = begin()
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/org-members')
      const data = await res.json().catch(() => ({}))
      if (isStale(gen)) return
      if (!res.ok) {
        setError(true)
        toast.error(data.error || 'Failed to load members.')
        return
      }
      setMembers(data.members || [])
      setInvites(data.invites || [])
      setCurrentUserId(data.currentUserId || '')
      const role = (data.currentUserRole || 'member') as 'owner' | 'admin' | 'member'
      setCurrentUserRole(role)
      onRoleResolved?.(role)
    } catch {
      if (isStale(gen)) return
      setError(true)
      toast.error('Failed to load members.')
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [toast, onRoleResolved, begin, isStale])

  useEffect(() => {
    let cancelled = false
    void refresh().finally(() => {
      if (cancelled) {
        setMembers([])
        setInvites([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      setMembers([])
      setInvites([])
      setLastInviteUrl(null)
      void refresh()
    }, [refresh, invalidate]),
  )

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteBusy(true)
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Failed to invite.')
        return
      }
      setLastInviteUrl(data.inviteUrl)
      setInviteEmail('')
      const emailed = data?.email_result?.sent
      toast.success(
        emailed
          ? `Invite emailed to ${data?.email || inviteEmail}.`
          : `Invite created for ${data?.email || inviteEmail}. Copy the link below to share it.`,
      )
      await refresh()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setInviteBusy(false)
    }
  }

  const changeRole = async (member: Member, role: string) => {
    if (member.role === 'owner' && role !== 'owner') {
      const ok = await confirm({
        title: 'Demote owner?',
        message: `${member.name} will lose owner privileges. Make sure another owner exists, or this organization may become unmanageable.`,
        destructive: true,
        confirmLabel: 'Demote',
      })
      if (!ok) return
    }
    try {
      const res = await fetch('/api/org-members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId: member.membershipId, role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to update role.')
        return
      }
      toast.success(`${member.name} is now ${role}.`)
      await refresh()
    } catch {
      toast.error('Network error — please try again.')
    }
  }

  const removeMember = async (member: Member) => {
    const isOwner = member.role === 'owner'
    const ok = await confirm({
      title: isOwner ? 'Remove owner?' : 'Remove member?',
      message: isOwner
        ? `${member.name} is an owner. Removing them is irreversible — make sure another owner exists.`
        : `${member.name} will immediately lose access to this organization.`,
      destructive: true,
      confirmLabel: 'Remove',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/org-members?id=${encodeURIComponent(member.membershipId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to remove member.')
        return
      }
      toast.success(`${member.name} removed.`)
      await refresh()
    } catch {
      toast.error('Network error — please try again.')
    }
  }

  const cancelInvite = async (i: PendingInvite) => {
    const ok = await confirm({
      title: 'Cancel invite?',
      message: `The invite link for ${i.email} will no longer work.`,
      destructive: true,
      confirmLabel: 'Cancel invite',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/auth/invite?id=${encodeURIComponent(i.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to cancel invite.')
        return
      }
      toast.success('Invite cancelled.')
      await refresh()
    } catch {
      toast.error('Network error — please try again.')
    }
  }

  const handleCopy = async (key: string, text: string) => {
    const ok = await copy(text)
    if (ok) {
      setCopiedKey(key)
      toast.success('Link copied to clipboard.')
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000)
    } else {
      toast.error('Could not copy to clipboard.')
    }
  }

  return (
    <div className="space-y-6">
      <ReadOnlySupportGuard />
      {canManage && (
        <div className="surface-card p-4 sm:p-6">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-fg">
            <UserPlusIcon className="h-5 w-5" aria-hidden="true" /> Invite a new member
          </h2>
          <form
            onSubmit={invite}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            noValidate
          >
            <div className="flex-1">
              <Input
                label="Email"
                labelHidden
                type="email"
                required
                autoComplete="email"
                placeholder="person@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="sm:w-40">
              <Select
                label="Role"
                labelHidden
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {currentUserRole === 'owner' && <option value="owner">Owner</option>}
              </Select>
            </div>
            <Button type="submit" loading={inviteBusy} disabled={supportReadOnly}>
              Send invite
            </Button>
          </form>
          {lastInviteUrl && (
            <Alert variant="success" className="mt-4" title="Invite created. Share this link:">
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 break-all rounded border border-border bg-surface px-2 py-1 text-xs">
                  {lastInviteUrl}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={
                    copiedKey === 'last' && copied ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : (
                      <ClipboardIcon className="h-4 w-4" />
                    )
                  }
                  onClick={() => handleCopy('last', lastInviteUrl)}
                  aria-label="Copy invite link"
                >
                  {copiedKey === 'last' && copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </Alert>
          )}
        </div>
      )}

      <MembersTable
        members={members}
        loading={loading}
        error={error}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        canManage={canManage}
        onChangeRole={changeRole}
        onRemove={removeMember}
        onRetry={() => void refresh()}
      />

      {invites.length > 0 && (
        <InvitesTable invites={invites} canManage={canManage} onCancel={cancelInvite} />
      )}
    </div>
  )
}

/* ─────────────────────────  Members table  ───────────────────────── */

function MembersTable({
  members,
  loading,
  error,
  currentUserId,
  currentUserRole,
  canManage,
  onChangeRole,
  onRemove,
  onRetry,
}: {
  members: Member[]
  loading: boolean
  error: boolean
  currentUserId: string
  currentUserRole: 'owner' | 'admin' | 'member'
  canManage: boolean
  onChangeRole: (m: Member, role: string) => void
  onRemove: (m: Member) => void
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="surface-card p-6">
        <SkeletonRows count={4} />
      </div>
    )
  }
  if (error) {
    return (
      <div className="surface-card p-6">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Couldn't load members"
          description="Try again in a moment."
          cta={{ label: 'Retry', onClick: onRetry }}
        />
      </div>
    )
  }

  const columns: DataColumn<Member>[] = [
    {
      id: 'name',
      header: 'Name',
      headerText: 'Name',
      cell: (m) => {
        const isYou = m.userId === currentUserId
        return (
          <div>
            <span className="font-medium text-fg">{m.name}</span>
            {isYou && <span className="ml-1 text-xs text-fg-muted">(you)</span>}
            <div className="truncate text-xs text-fg-muted md:hidden">{m.email}</div>
          </div>
        )
      },
      exportValue: (m) => m.name,
      filter: { type: 'text' },
    },
    {
      id: 'email',
      header: 'Email',
      headerText: 'Email',
      hideBelow: 'md',
      cell: (m) => <span className="text-fg">{m.email}</span>,
      exportValue: (m) => m.email,
      filter: { type: 'text' },
    },
    {
      id: 'role',
      header: 'Role',
      headerText: 'Role',
      filter: {
        type: 'multiselect',
        options: [
          { value: 'owner', label: 'Owner' },
          { value: 'admin', label: 'Admin' },
          { value: 'member', label: 'Member' },
        ],
        getValue: (m) => m.role,
      },
      cell: (m) => {
        const isYou = m.userId === currentUserId
        if (canManage && !isYou) {
          return (
            <>
              <label className="sr-only" htmlFor={`role-${m.membershipId}`}>
                Role for {m.name}
              </label>
              <select
                id={`role-${m.membershipId}`}
                value={m.role}
                onChange={(e) => onChangeRole(m, e.target.value)}
                className={`focus-ring rounded border px-2 py-1 text-xs ${ROLE_BADGE[m.role]}`}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                {currentUserRole === 'owner' && <option value="owner">Owner</option>}
              </select>
            </>
          )
        }
        return (
          <span className={`rounded border px-2 py-1 text-xs ${ROLE_BADGE[m.role]}`}>{m.role}</span>
        )
      },
      exportValue: (m) => m.role,
    },
    {
      id: 'joined',
      header: 'Joined',
      headerText: 'Joined',
      hideBelow: 'lg',
      cell: (m) => (
        <span className="text-xs text-fg-muted tabular">
          {new Date(m.joinedAt).toLocaleDateString()}
        </span>
      ),
      exportValue: (m) => (m.joinedAt ? new Date(m.joinedAt) : ''),
      filter: { type: 'dateRange', getValue: (m) => m.joinedAt || null },
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerText: 'Actions',
      align: 'right',
      cell: (m) => {
        const isYou = m.userId === currentUserId
        if (!canManage || isYou) return null
        return (
          <button
            onClick={() => onRemove(m)}
            aria-label={`Remove ${m.name}`}
            title="Remove member"
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <TrashIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )
      },
      exportValue: () => '',
    },
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">Active members ({members.length})</h2>
      </div>
      <DataView
        tableId="org-members"
        rows={members}
        columns={columns}
        rowKey={(m) => m.membershipId}
        globalSearch={{ placeholder: 'Search name, email…' }}
        pageSize={10}
        mobileCard={(m) => {
          const isYou = m.userId === currentUserId
          return (
            <div className="surface-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-fg">
                    {m.name}
                    {isYou && <span className="ml-1 text-xs text-fg-muted">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-fg-muted">{m.email}</div>
                </div>
                <span className={`shrink-0 rounded border px-2 py-1 text-xs ${ROLE_BADGE[m.role]}`}>
                  {m.role}
                </span>
              </div>
              {canManage && !isYou && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => onRemove(m)}
                    aria-label={`Remove ${m.name}`}
                    className="focus-ring inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-800 dark:text-red-400"
                  >
                    <TrashIcon className="h-4 w-4" aria-hidden="true" /> Remove
                  </button>
                </div>
              )}
            </div>
          )
        }}
        empty={
          <EmptyState
            icon={<UserGroupIcon />}
            title="No members"
            description={
              canManage ? 'Invite a member to give them access.' : 'Contact an admin to be added.'
            }
            cta={null}
          />
        }
      />
    </div>
  )
}

/* ─────────────────────────  Invites table  ───────────────────────── */

function InvitesTable({
  invites,
  canManage,
  onCancel,
}: {
  invites: PendingInvite[]
  canManage: boolean
  onCancel: (i: PendingInvite) => void
}) {
  const columns: DataColumn<PendingInvite>[] = [
    {
      id: 'email',
      header: 'Email',
      headerText: 'Email',
      cell: (i) => <span className="font-medium text-fg">{i.email}</span>,
      exportValue: (i) => i.email,
      filter: { type: 'text' },
    },
    {
      id: 'role',
      header: 'Role',
      headerText: 'Role',
      cell: (i) => (
        <span className={`rounded border px-2 py-1 text-xs ${ROLE_BADGE[i.role]}`}>{i.role}</span>
      ),
      exportValue: (i) => i.role,
      filter: {
        type: 'multiselect',
        options: [
          { value: 'owner', label: 'Owner' },
          { value: 'admin', label: 'Admin' },
          { value: 'member', label: 'Member' },
        ],
      },
    },
    {
      id: 'expires',
      header: 'Expires',
      headerText: 'Expires',
      hideBelow: 'md',
      cell: (i) => (
        <span className="text-xs text-fg-muted tabular">
          {new Date(i.expiresAt).toLocaleDateString()}
        </span>
      ),
      exportValue: (i) => (i.expiresAt ? new Date(i.expiresAt) : ''),
      filter: { type: 'dateRange', getValue: (i) => i.expiresAt || null },
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerText: 'Actions',
      align: 'right',
      cell: (i) =>
        canManage ? (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={() => onCancel(i)}
              aria-label={`Cancel invite for ${i.email}`}
              title="Cancel invite"
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <TrashIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null,
      exportValue: () => '',
    },
  ]

  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold text-fg">Pending invites ({invites.length})</h2>
      <DataView
        tableId="org-invites"
        rows={invites}
        columns={columns}
        rowKey={(i) => i.id}
        globalSearch={{ placeholder: 'Search invites…' }}
        pageSize={10}
        mobileCard={(i) => (
          <div className="surface-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-fg truncate">{i.email}</div>
                <div className="text-xs text-fg-muted tabular">
                  Expires {new Date(i.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <span className={`shrink-0 rounded border px-2 py-1 text-xs ${ROLE_BADGE[i.role]}`}>
                {i.role}
              </span>
            </div>
            {canManage && (
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => onCancel(i)}
                  className="focus-ring inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-800 dark:text-red-400"
                >
                  <TrashIcon className="h-4 w-4" aria-hidden="true" /> Cancel
                </button>
              </div>
            )}
          </div>
        )}
      />
    </div>
  )
}
