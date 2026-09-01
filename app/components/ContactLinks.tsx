import type { ReactNode } from 'react'
import { mailtoHref, phoneTelHref } from '@/lib/contact-links'
import { formatPhoneDisplay } from '@/lib/phone-format'

const linkClassName =
  'font-medium text-accent underline-offset-2 hover:underline focus-ring rounded-sm'

type ContactLinkProps = {
  value?: string | null
  className?: string
  children?: ReactNode
}

export function PhoneLink({ value, className, children }: ContactLinkProps) {
  if (!value?.trim()) return null
  const href = phoneTelHref(value)
  if (!href) return null

  return (
    <a href={href} className={[linkClassName, 'tabular', className].filter(Boolean).join(' ')}>
      {children ?? formatPhoneDisplay(value)}
    </a>
  )
}

export function EmailLink({ value, className, children }: ContactLinkProps) {
  const email = value?.trim()
  if (!email) return null
  const href = mailtoHref(email)
  if (!href) return null

  return (
    <a href={href} className={[linkClassName, 'break-all', className].filter(Boolean).join(' ')}>
      {children ?? email}
    </a>
  )
}
