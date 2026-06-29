'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Button, Card, Input, PageHeader, SkeletonRows } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import TwoFactorSection from './TwoFactorSection'

interface Profile {
  name: string
  email: string
  image: string | null
  twoFactorEnabled: boolean
  createdAt: string | null
  notificationPreferences: {
    tasks: boolean
    payments: boolean
    statements: boolean
  }
}

export default function AccountPage() {
  const toast = useToast()
  const { update: updateSession } = useSession()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password change form.
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingNotifications, setSavingNotifications] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user')
      if (!res.ok) {
        toast.error('Could not load your profile.')
        return
      }
      const data = (await res.json().catch(() => null)) as Profile | null
      if (data) {
        setProfile({
          ...data,
          notificationPreferences: data.notificationPreferences ?? {
            tasks: true,
            payments: true,
            statements: true,
          },
        })
        setName(data.name || '')
      }
    } catch {
      toast.error('Could not load your profile.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    void refresh().finally(() => {
      if (cancelled) setProfile(null)
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Name cannot be empty.')
      return
    }
    setSavingProfile(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not save profile.')
        return
      }
      toast.success('Profile updated.')
      // Refresh the NextAuth session so the sidebar picks up the new name.
      await updateSession()
      invalidateCache('/api/user')
      void refresh()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleSaveNotificationPref = async (
    key: 'tasks' | 'payments' | 'statements',
    enabled: boolean,
  ) => {
    if (!profile) return
    setSavingNotifications(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationPreferences: { [key]: enabled } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not save notification preferences.')
        return
      }
      toast.success('Notification preferences updated.')
      invalidateCache('/api/user')
      void refresh()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setSavingNotifications(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.')
      return
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not change password.')
        return
      }
      toast.success('Password changed.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Your account" subtitle="Update your profile and security settings." />

        {loading || !profile ? (
          <Card>
            <SkeletonRows count={4} />
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <h2 className="text-base font-semibold text-fg mb-4">Profile</h2>
              <form onSubmit={handleSaveProfile} className="space-y-4" noValidate>
                <Input
                  label="Name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
                <Input
                  label="Email"
                  type="email"
                  value={profile.email}
                  disabled
                  hint="Email cannot be changed here. Contact an admin if you need to update it."
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={savingProfile}>
                    Save changes
                  </Button>
                </div>
              </form>
            </Card>

            <Card>
              <h2 className="text-base font-semibold text-fg mb-4">Change password</h2>
              <form onSubmit={handleChangePassword} className="space-y-4" noValidate>
                <Input
                  label="Current password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <Input
                  label="New password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  hint="At least 8 characters."
                />
                <Input
                  label="Confirm new password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={savingPassword}>
                    Update password
                  </Button>
                </div>
              </form>
            </Card>

            <Card>
              <h2 className="text-base font-semibold text-fg mb-1">In-app notifications</h2>
              <p className="text-sm text-fg-muted mb-4">
                Choose which notification types appear in your inbox.
              </p>
              <ul className="space-y-3">
                {(
                  [
                    ['tasks', 'Tasks', 'Reminders and updates about tasks assigned to you.'],
                    ['payments', 'Payments', 'Payment confirmations and billing activity.'],
                    ['statements', 'Statements', 'When new statements are available.'],
                  ] as const
                ).map(([key, label, hint]) => (
                  <li
                    key={key}
                    className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{label}</p>
                      <p className="text-xs text-fg-muted mt-0.5">{hint}</p>
                    </div>
                    <label className="inline-flex items-center gap-2 shrink-0">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={profile.notificationPreferences[key]}
                        disabled={savingNotifications}
                        onChange={(e) => void handleSaveNotificationPref(key, e.target.checked)}
                      />
                      <span className="sr-only">{label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>

            <TwoFactorSection enabled={profile.twoFactorEnabled} onChange={refresh} />
          </div>
        )}
      </div>
    </div>
  )
}
