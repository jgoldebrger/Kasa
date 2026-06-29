import { z } from 'zod'
import { email, password, objectId, role, trimmedName } from './common'

export const signupBody = z.object({
  name: trimmedName.max(120),
  email,
  password,
  inviteCode: z.string().trim().min(1, 'Invite code required').max(80),
})

export const requestInviteBody = z.object({
  name: trimmedName.max(120),
  email,
  organization: trimmedName.optional(),
  message: z.string().trim().max(2000).optional(),
})

export const acceptInviteBody = z.object({
  token: z.string().trim().min(1, 'Token required').max(200),
  name: trimmedName.max(120).optional(),
  password: password.optional(),
})

export const resetPasswordRequestBody = z.object({
  email,
})

export const resetPasswordConfirmBody = z.object({
  token: z.string().trim().min(1).max(200),
  newPassword: password,
})

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Current password required').max(200),
  newPassword: password,
})

export const notificationPreferencesBody = z.object({
  tasks: z.boolean().optional(),
  payments: z.boolean().optional(),
  statements: z.boolean().optional(),
})

export const updateProfileBody = z
  .object({
    name: trimmedName.max(120).optional(),
    notificationPreferences: notificationPreferencesBody.optional(),
  })
  .refine((v) => v.name !== undefined || v.notificationPreferences !== undefined, {
    message: 'Nothing to update.',
  })

export const inviteUserBody = z.object({
  email,
  role,
  organizationId: objectId.optional(),
})
