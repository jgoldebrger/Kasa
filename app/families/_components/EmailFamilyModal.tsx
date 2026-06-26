'use client'

import { useMemo } from 'react'
import EmailFamiliesModal, { type EmailFamilyRow } from './EmailFamiliesModal'

export interface EmailFamilyModalProps {
  open: boolean
  onClose: () => void
  family: EmailFamilyRow
  onSent?: () => void
}

/** Single-family compose modal — thin wrapper around EmailFamiliesModal. */
export default function EmailFamilyModal({ open, onClose, family, onSent }: EmailFamilyModalProps) {
  const families = useMemo(() => [family], [family])
  const selectedIds = useMemo(() => new Set([family._id]), [family._id])

  return (
    <EmailFamiliesModal
      open={open}
      onClose={onClose}
      families={families}
      selectedIds={selectedIds}
      onSent={onSent}
    />
  )
}
