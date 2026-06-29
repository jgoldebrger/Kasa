'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { EnvelopeIcon } from '@heroicons/react/24/outline'
import { formatLocaleDate } from '@/lib/date-utils'
import { useFamilyDetail } from '../FamilyDetailContext'
import { Badge, Card, EmptyState, SkeletonRows } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'

interface EmailLogRow {
  _id: string
  subject: string
  kind: string
  status: string
  openCount: number
  clickCount: number
  error: string | null
  createdAt: string
  firstOpenedAt: string | null
}

const EMAIL_KIND_KEYS: Record<string, MessageKey> = {
  custom: 'communications.emailKind.custom',
  statement: 'communications.emailKind.statement',
  'tax-receipt': 'communications.emailKind.tax-receipt',
  'task-reminder': 'communications.emailKind.task-reminder',
  file: 'communications.emailKind.file',
}

function emailKindLabel(kind: string, t: ReturnType<typeof useT>): string {
  const key = EMAIL_KIND_KEYS[kind]
  return key ? t(key) : kind.replace(/-/g, ' ')
}

export default function EmailsTab() {
  const { familyId } = useFamilyDetail()
  const t = useT()
  const [rows, setRows] = useState<EmailLogRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!familyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/families/${familyId}/emails?limit=50`)
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      setRows((data.items ?? []) as EmailLogRow[])
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
      <Card>
        <SkeletonRows count={5} />
      </Card>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<EnvelopeIcon className="h-10 w-10" />}
        title={t('family.emails.empty.title')}
        description={t('family.emails.empty.description')}
        cta={{
          label: t('family.emails.composeForFamily'),
          href: `/communications?familyId=${familyId}`,
        }}
      />
    )
  }

  return (
    <Card compact className="overflow-hidden">
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={row._id}
            className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
          >
            <div className="flex-1 min-w-0">
              <Link
                href={`/communications?emailId=${row._id}`}
                className="font-medium text-fg truncate block hover:text-accent hover:underline"
                title={t('family.emails.viewDetail')}
              >
                {row.subject}
              </Link>
              <p className="text-xs text-fg-muted tabular mt-0.5">
                {row.createdAt ? formatLocaleDate(row.createdAt) : '—'} ·{' '}
                {emailKindLabel(row.kind, t)}
                {row.firstOpenedAt && (
                  <>
                    {' '}
                    · {t('family.emails.firstOpened')}: {formatLocaleDate(row.firstOpenedAt)}
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-fg-muted tabular">
                {t('communications.column.tracking')}: {row.openCount}/{row.clickCount}
              </span>
              <Badge size="sm">{row.status}</Badge>
            </div>
            {row.status === 'failed' && row.error && (
              <p className="text-xs text-danger mt-2 line-clamp-2">{row.error}</p>
            )}
          </li>
        ))}
      </ul>
      <div className="px-4 py-2 border-t border-border text-center">
        <Link href="/communications" className="text-sm text-accent hover:underline">
          {t('family.emails.viewAll')}
        </Link>
      </div>
    </Card>
  )
}
