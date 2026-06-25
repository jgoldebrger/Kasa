'use client'

import Link from 'next/link'
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
import { useT } from '@/lib/client/i18n'

export interface ContextualHelpLinkProps {
  slug: string
  className?: string
}

/** Small help button linking to a contextual help article. */
export default function ContextualHelpLink({ slug, className = '' }: ContextualHelpLinkProps) {
  const t = useT()

  return (
    <Link
      href={`/help/${slug}`}
      className={`focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-fg/5 hover:text-fg-muted transition-colors ${className}`}
      aria-label={t('help.contextual.label')}
      title={t('help.contextual.label')}
    >
      <QuestionMarkCircleIcon className="h-5 w-5" aria-hidden="true" />
    </Link>
  )
}
