'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import ContextualHelpLink from '@/app/components/ContextualHelpLink'
import { Badge, Card, SkeletonRows } from '@/app/components/ui'
import { formatLocaleDate } from '@/lib/date-utils'
import { useT } from '@/lib/client/i18n'

interface MemberEmailRow {
  _id: string
  subject: string
  status: string
  createdAt: string
}

interface MemberEmailsSectionProps {
  familyId: string
}

const EMAIL_LIMIT = 10

export default function MemberEmailsSection({ familyId }: MemberEmailsSectionProps) {
  const t = useT()
  const [rows, setRows] = useState<MemberEmailRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!familyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/families/${familyId}/emails?limit=${EMAIL_LIMIT}`)
      if (!res.ok) {
        setRows([])
        return
      }
      const data = await res.json()
      setRows((data.items ?? []) as MemberEmailRow[])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <Card compact>
        <SkeletonRows count={3} />
      </Card>
    )
  }

  return (
    <Card compact>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-fg">Emails from your kehilla</h4>
        <ContextualHelpLink slug="email-setup" />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('family.emails.empty.description')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row._id}
              className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{row.subject}</p>
                <p className="text-xs text-fg-muted tabular">
                  {row.createdAt ? formatLocaleDate(row.createdAt) : '—'}
                </p>
              </div>
              <Badge size="sm" className="shrink-0 self-start sm:self-center">
                {row.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-border pt-2">
        <Link
          href="/help/email-setup"
          className="focus-ring inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover"
        >
          <EnvelopeIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Learn about email from your kehilla
        </Link>
      </div>
    </Card>
  )
}
