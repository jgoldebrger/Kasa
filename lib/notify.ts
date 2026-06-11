/**

 * Create in-app notifications.

 *

 * Wrap `Notification.create()` so callers don't have to remember the

 * schema shape. Failures are swallowed (and logged) — a missed

 * notification should never break the underlying business action.

 *

 * Flavors:

 *   - `notifyUser(orgId, userId, …)`  — single recipient

 *   - `notifyAdmins(orgId, …)`        — one row per owner/admin (preferred

 *     for financial or admin-only context; org members never see these)

 *   - `notifyOrg(orgId, …)`           — org-wide (`userId: null`); every

 *     member can see it until marked read (use sparingly)

 */



import { Notification, OrgMembership } from './models'



export interface NotifyInput {

  kind: string

  title: string

  body?: string

  link?: string

  metadata?: Record<string, unknown>

}



/** Kinds that must not be visible to org `member` role (legacy org-wide rows too). */

export const ADMIN_ONLY_NOTIFICATION_KINDS = new Set([

  'dispute.opened',

  'payment.canceled',

  'payment.failed',

  'invite.accepted',

])



export async function notifyUser(

  organizationId: string | unknown,

  userId: string | unknown,

  input: NotifyInput,

): Promise<void> {

  try {

    await Notification.create({

      organizationId,

      userId,

      kind: input.kind,

      title: input.title,

      body: input.body || '',

      link: input.link || '',

      metadata: input.metadata || {},

    })

  } catch (err) {

    console.error('[notify] notifyUser failed:', err)

  }

}



/** Notify every owner and admin in the org (per-user rows). */

export async function notifyAdmins(

  organizationId: string | unknown,

  input: NotifyInput,

): Promise<void> {

  try {

    const admins = await OrgMembership.find({

      organizationId,

      role: { $in: ['owner', 'admin'] },

    })

      .select('userId')

      .lean<{ userId: unknown }[]>()



    if (admins.length === 0) return



    await Notification.insertMany(

      admins.map((m) => ({

        organizationId,

        userId: m.userId,

        kind: input.kind,

        title: input.title,

        body: input.body || '',

        link: input.link || '',

        metadata: input.metadata || {},

      })),

      { ordered: false },

    )

  } catch (err) {

    console.error('[notify] notifyAdmins failed:', err)

  }

}



export async function notifyOrg(

  organizationId: string | unknown,

  input: NotifyInput,

): Promise<void> {

  try {

    await Notification.create({

      organizationId,

      userId: null,

      kind: input.kind,

      title: input.title,

      body: input.body || '',

      link: input.link || '',

      metadata: input.metadata || {},

    })

  } catch (err) {

    console.error('[notify] notifyOrg failed:', err)

  }

}


