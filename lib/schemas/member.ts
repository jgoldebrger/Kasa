import { z } from 'zod'
import { email, objectId, role } from './common'

export const addMemberBody = z.object({
  email,
  role,
})

export const updateMemberRoleBody = z.object({
  role,
})

export const removeMemberQuery = z.object({
  membershipId: objectId,
})
