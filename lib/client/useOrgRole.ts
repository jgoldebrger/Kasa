'use client'

/**
 * Resolves the user's role in the active organization. Uses the same
 * `/api/organizations` payload as OrgSwitcher and refreshes on org switch.
 * When wrapped in `OrgRoleProvider` with `initialRole`, skips the first
 * client fetch for faster paint.
 */

export { OrgRoleProvider, useOrgRole } from '@/lib/client/OrgRoleContext'
