import { Types } from 'mongoose'

/** Active (non-deleted) tenant filter for standard Mongoose queries. */
export function tenantMatch(
  organizationId: string | Types.ObjectId,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    organizationId:
      organizationId instanceof Types.ObjectId
        ? organizationId
        : new Types.ObjectId(String(organizationId)),
    deletedAt: null,
    ...extra,
  }
}

/** `$match` stage for aggregation pipelines (ObjectId-cast org id + soft-delete). */
export function tenantAggregate(
  organizationId: string | Types.ObjectId,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const orgOid =
    organizationId instanceof Types.ObjectId
      ? organizationId
      : new Types.ObjectId(String(organizationId))
  return {
    $match: {
      organizationId: orgOid,
      deletedAt: null,
      ...extra,
    },
  }
}
