import type { Role, OrgPermission } from '@/types/auth'

function isAdminRole(role: Role): boolean {
  return role === 'admin' || role === 'owner'
}

const ROLE_PERMISSIONS: Record<Role, readonly OrgPermission[]> = {
  owner: [
    'families:read',
    'payments:read',
    'reports:read',
    'communications:read',
    'communications:write',
  ],
  admin: [
    'families:read',
    'payments:read',
    'reports:read',
    'communications:read',
    'communications:write',
  ],
  member: ['families:read', 'communications:read'],
  treasurer: ['families:read', 'payments:read', 'reports:read'],
  communications: ['families:read', 'communications:read', 'communications:write'],
}

/** Preset specialist roles assignable from Settings → Members. */
export const PRESET_ORG_ROLES = ['treasurer', 'communications'] as const satisfies readonly Role[]

export type PresetOrgRole = (typeof PRESET_ORG_ROLES)[number]

export function isPresetOrgRole(role: string): role is PresetOrgRole {
  return (PRESET_ORG_ROLES as readonly string[]).includes(role)
}

/** True when `role` grants the given permission (owners/admins grant all). */
export function hasOrgPermission(role: Role, permission: OrgPermission): boolean {
  if (isAdminRole(role)) return true
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export const API_KEY_SCOPES: readonly OrgPermission[] = ['families:read', 'payments:read']
