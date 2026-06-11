'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { useToast, useConfirm } from '@/app/components/Toast'
import { PLATFORM_ADMIN_2FA_REQUIRED_CODE } from '@/lib/platform-admin'

type RequestRow = {
  id: string
  email: string
  name: string
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
      const url = filter === 'all'
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

  const act = async (id: string, action: 'approve' | 'reject' | 'reissue', rejectReason?: string) => {
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
        toast.success('Request rejected.')
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Invitation requests</h1>
          <p className="text-sm text-fg-muted mt-1">
            Review who has asked for access. Approving generates a one-time signup link.
          </p>
        </div>
        {!emailEnabled && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2 max-w-xs">
            Platform email is not configured. Approval emails won&apos;t be sent — copy the
            signup link manually.
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              filter === f
                ? 'bg-accent text-white border-blue-600'
                : 'bg-surface text-fg border-border hover:bg-app-subtle'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-fg-muted">Loading…</div>
      ) : twoFactorRequired ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-6 space-y-3">
          <p className="font-medium">Two-factor authentication required</p>
          <p className="text-sm">
            Platform admin access requires 2FA on your account. Enable it in account settings,
            then return to this page.
          </p>
          <Link
            href="/account"
            className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover"
          >
            Go to account settings →
          </Link>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">{error}</div>
      ) : rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-10 text-center text-fg-muted">
          No requests {filter !== 'all' ? `(${filter})` : ''}.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-fg">{row.name}</div>
                  <div className="text-sm text-fg-muted">{row.email}</div>
                  <div className="text-xs text-fg-subtle mt-1">
                    Requested {new Date(row.createdAt).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full ${
                    row.status === 'pending'
                      ? 'bg-amber-100 text-amber-800'
                      : row.status === 'approved'
                      ? row.usedAt
                        ? 'bg-fg/5 text-fg'
                        : 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {row.status === 'approved' && row.usedAt ? 'used' : row.status}
                </span>
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
                    <input
                      readOnly
                      value={row.signupUrl}
                      className="flex-1 text-xs bg-surface border border-accent/20 rounded px-2 py-1.5"
                    />
                    <button
                      onClick={() => copy(row.signupUrl!)}
                      className="text-xs bg-accent text-white px-3 py-1.5 rounded hover:bg-accent-hover"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {row.status === 'rejected' && row.rejectReason && (
                <div className="text-sm text-red-700 bg-red-50 rounded p-3">
                  Reason: {row.rejectReason}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {row.status === 'pending' && (
                  <>
                    <button
                      onClick={() => act(row.id, 'approve')}
                      disabled={busyId === row.id}
                      className="bg-green-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-60"
                    >
                      {busyId === row.id ? 'Working…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleReject(row)}
                      disabled={busyId === row.id}
                      className="bg-surface text-red-700 border border-red-300 px-4 py-1.5 rounded text-sm font-medium hover:bg-red-50 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}
                {row.status === 'approved' && !row.usedAt && (
                  <button
                    onClick={() => handleReissue(row)}
                    disabled={busyId === row.id}
                    className="bg-surface text-fg border border-border px-4 py-1.5 rounded text-sm font-medium hover:bg-app-subtle disabled:opacity-60"
                  >
                    Re-issue code
                  </button>
                )}
                {row.status === 'rejected' && (
                  <button
                    onClick={() => act(row.id, 'approve')}
                    disabled={busyId === row.id}
                    className="bg-green-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-60"
                  >
                    Approve instead
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
