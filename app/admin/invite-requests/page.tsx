'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { useToast, useConfirm } from '@/app/components/Toast'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  SkeletonRows,
} from '@/app/components/ui'

type RequestRow = {
  id: string
  email: string
  name: string
  orgName: string | null
  message: string
  status: 'pending' | 'approved' | 'rejected'
  signupCode: string | null
  signupUrl: string | null
  signupCodeExpiresAt: string | null
  usedAt: string | null
  rejectReason: string | null
  createdAt: string
  reviewedAt: string | null
}

function statusBadge(row: RequestRow) {
  if (row.status === 'pending') {
    return <Badge variant="warning">pending</Badge>
  }
  if (row.status === 'approved') {
    return row.usedAt ? (
      <Badge variant="muted">used</Badge>
    ) : (
      <Badge variant="success">approved</Badge>
    )
  }
  return <Badge variant="danger">rejected</Badge>
}

export default function InviteRequestsAdminPage() {
  const toast = useToast()
  const confirm = useConfirm()

  const [rows, setRows] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setTwoFactorRequired(false)
    try {
      const url =
        filter === 'all'
          ? '/api/admin/invite-requests'
          : `/api/admin/invite-requests?status=${filter}`
      const res = await fetch(url)
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}))
        if (data?.code === PLATFORM_ADMIN_2FA_REQUIRED_CODE) {
          setTwoFactorRequired(true)
          setRows([])
          return
        }
        setError('You don\u2019t have permission to view this page.')
        setRows([])
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to load')
      }
      const data = await res.json().catch(() => ({}))
      setRows(data.requests || [])
      setEmailEnabled(Boolean(data.emailEnabled))
    } catch (err: any) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    let cancelled = false
    void load().finally(() => {
      if (cancelled) setRows([])
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const act = async (
    id: string,
    action: 'approve' | 'reject' | 'reissue',
    rejectReason?: string,
  ) => {
    setBusyId(id)
    try {
      const res = await fetch('/api/admin/invite-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, rejectReason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || 'Action failed')
        return
      }
      if (action === 'approve' || action === 'reissue') {
        if (data?.email?.sent) {
          toast.success('Approved and emailed the requester.')
        } else if (data?.email?.reason === 'platform SMTP not configured') {
          toast.success('Approved. Copy the signup link below to share with the requester.')
        } else {
          toast.success('Approved. Email delivery failed — copy the signup link below.')
        }
      } else {
        if (data?.email?.sent) {
          toast.success('Rejected and notified the requester.')
        } else {
          toast.success('Request rejected.')
        }
      }
      await load()
    } catch (err: any) {
      toast.error(err.message || 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (row: RequestRow) => {
    const ok = await confirm({
      title: 'Reject this request?',
      message: `Reject the invitation request from ${row.email}?`,
      confirmLabel: 'Reject',
      destructive: true,
    })
    if (!ok) return
    await act(row.id, 'reject')
  }

  const handleReissue = async (row: RequestRow) => {
    const ok = await confirm({
      title: 'Issue a new code?',
      message: `This will invalidate the current signup link for ${row.email} and generate a fresh one.`,
      confirmLabel: 'Generate new code',
    })
    if (!ok) return
    await act(row.id, 'reissue')
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Invitation requests"
        subtitle="Review who has asked for access. Approving generates a one-time signup link."
        actions={
          !emailEnabled ? (
            <Alert variant="warning" className="max-w-xs text-xs">
              Platform email is not configured. Approval emails won&apos;t be sent — copy the signup
              link manually.
            </Alert>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'secondary'}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {loading ? (
        <Card>
          <SkeletonRows count={5} />
        </Card>
      ) : twoFactorRequired ? (
        <Alert variant="warning" title="Two-factor authentication required">
          <p>
            Platform admin access requires 2FA on your account. Enable it in account settings, then
            return to this page.
          </p>
          <Link
            href="/account"
            className="mt-2 inline-flex text-sm font-medium text-accent hover:text-accent-hover"
          >
            Go to account settings →
          </Link>
        </Alert>
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          title={`No requests${filter !== 'all' ? ` (${filter})` : ''}`}
          description="New invitation requests will appear here when someone asks for access."
          cta={null}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} compact className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  {row.orgName && (
                    <div className="text-lg font-semibold text-fg mb-0.5">{row.orgName}</div>
                  )}
                  <div className={`font-semibold text-fg ${row.orgName ? 'text-sm' : ''}`}>
                    {row.name}
                  </div>
                  <div className="text-sm text-fg-muted">{row.email}</div>
                  <div className="text-xs text-fg-subtle mt-1">
                    Requested {new Date(row.createdAt).toLocaleString()}
                  </div>
                </div>
                {statusBadge(row)}
              </div>

              {row.message && (
                <div className="text-sm text-fg bg-app-subtle rounded p-3 whitespace-pre-wrap">
                  {row.message}
                </div>
              )}

              {row.status === 'approved' && row.signupUrl && !row.usedAt && (
                <div className="bg-accent/10 border border-accent/20 rounded p-3 space-y-2">
                  <div className="text-xs text-fg font-medium">
                    Signup link
                    {row.signupCodeExpiresAt && (
                      <span className="text-accent font-normal ml-2">
                        expires {new Date(row.signupCodeExpiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={row.signupUrl}
                      labelHidden
                      aria-label="Signup link"
                      wrapperClassName="flex-1"
                      className="text-xs"
                    />
                    <Button size="sm" onClick={() => copy(row.signupUrl!)}>
                      Copy
                    </Button>
                  </div>
                </div>
              )}

              {row.status === 'rejected' && row.rejectReason && (
                <Alert variant="danger" title="Reason">
                  {row.rejectReason}
                </Alert>
              )}

              <div className="flex flex-wrap gap-2">
                {row.status === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => act(row.id, 'approve')}
                      loading={busyId === row.id}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleReject(row)}
                      disabled={busyId === row.id}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {row.status === 'approved' && !row.usedAt && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleReissue(row)}
                    loading={busyId === row.id}
                  >
                    Re-issue code
                  </Button>
                )}
                {row.status === 'rejected' && (
                  <Button
                    size="sm"
                    onClick={() => act(row.id, 'approve')}
                    loading={busyId === row.id}
                  >
                    Approve instead
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
