import { z } from 'zod'
import { objectId, trimmedName } from './common'

export const organizationCreateBody = z.object({
  name: trimmedName.min(2, 'Name must be at least 2 characters'),
})

export const organizationSwitchBody = z.object({
  activeOrgId: objectId,
})
