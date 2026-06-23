'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'

interface ImpersonationState {
  active: boolean
  organizationName?: string | null
}

export default function PlatformImpersonationBanner() {
  const router = useRouter()
  const toast = useToast()
  const { data: session } = useSession()
  const [state, setState] = useState<ImpersonationState | null>(null)
  const [exiting, setExiting] = useState(false)

  const isPlatformAdmin = Boolean(session?.user?.isPlatformAdmin)

  const refresh = useCallback(async () => {
    if (!isPlatformAdmin) {
      setState({ active: false })
      return
    }
    try {
      const res = await fetch('/api/admin/impersonate')
      if (res.status === 403 || res.status === 401) {
        setState({ active: false })
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setState({
        active: Boolean(data.active),
        organizationName: data.organizationName,
      })
    } catch {
      // Non-platform users — hide banner.
      setState({ active: false })
    }
  }, [isPlatformAdmin])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!isPlatformAdmin) return null

  async function exitSupportMode() {
    setExiting(true)
    try {
      const res = await fetch('/api/admin/impersonate', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Could not exit support mode.')
        return
      }
      toast.success('Exited support mode.')
      setState({ active: false })
      router.push('/admin')
      router.refresh()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setExiting(false)
    }
  }

  if (!state?.active) return null

  return (
    <div
      role="status"
      className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-sm text-fg flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        <strong className="font-semibold">Support mode:</strong> viewing{' '}
        <span className="font-medium">{state.organizationName || 'organization'}</span> as admin.
        Actions are logged.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={exiting}
        onClick={exitSupportMode}
      >
        Exit support mode
      </Button>
    </div>
  )
}
