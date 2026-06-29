import { Task, EmailConfig, Organization } from '@/lib/models'
import { safeDecrypt, decryptFailureMessage } from '@/lib/encryption'
import { escapeHtml } from '@/lib/html-escape'
import { sanitizeFromName } from '@/lib/email-from-name'
import { createGmailTransport, sendEmail } from '@/lib/mail'
import { sanitizeBatchErrors, sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { checkRateLimit } from '@/lib/rate-limit'
import { calendarDayBoundsInTimeZone } from '@/lib/date-utils'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

// POST - Send emails for tasks due today
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'POST /api/tasks/send-due-date-emails',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'task-due-emails',
      { limit: 5, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const emailConfig = await EmailConfig.findOne({
      isActive: true,
      organizationId: ctx!.organizationId,
    })
    if (!emailConfig) {
      return {
        status: 400,
        data: { error: 'Email configuration not found. Please configure email settings first.' },
      }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('timezone')
      .lean<{ timezone?: string }>()
    const { from, toExclusive } = calendarDayBoundsInTimeZone(org?.timezone)

    const tasksDueToday = await loadAllByIdCursor<any>(
      (filter, limit) =>
        Task.find(filter)
          .populate({
            path: 'assigneeUserId',
            select: 'name email',
          })
          .populate({
            path: 'relatedFamilyId',
            select: 'name organizationId',
            match: { organizationId: ctx!.organizationId },
          })
          .populate({
            path: 'relatedMemberId',
            select: 'firstName lastName organizationId',
            match: { organizationId: ctx!.organizationId },
          })
          .sort({ _id: 1 })
          .limit(limit)
          .lean(),
      {
        dueDate: { $gte: from, $lt: toExclusive },
        emailSent: false,
        status: { $ne: 'completed' },
        organizationId: ctx!.organizationId,
      },
    )

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (tasksDueToday.length === 0) {
      return {
        data: {
          message: 'No tasks due today that need email notifications',
          sent: 0,
          failed: 0,
        },
      }
    }

    const decrypted = safeDecrypt(emailConfig.password)
    if (!decrypted.ok) {
      return { status: 500, data: { error: decryptFailureMessage(decrypted.reason) } }
    }

    const transporter = createGmailTransport({
      email: emailConfig.email,
      password: decrypted.value,
    })
    const mailConfig = {
      email: emailConfig.email,
      password: decrypted.value,
      fromName: sanitizeFromName(emailConfig.fromName),
    }

    const results = {
      sent: 0,
      failed: 0,
      errors: [] as string[],
    }

    for (const task of tasksDueToday) {
      try {
        const claim = await Task.findOneAndUpdate(
          {
            _id: task._id,
            organizationId: ctx!.organizationId,
            emailSent: false,
            status: { $ne: 'completed' },
          },
          { $set: { emailSent: true } },
          { new: false },
        )
        if (!claim) continue

        const to = String(
          (task.assigneeUserId &&
            typeof task.assigneeUserId === 'object' &&
            'email' in task.assigneeUserId &&
            (task.assigneeUserId as { email?: string }).email) ||
            task.email ||
            '',
        ).trim()
        if (!to || !EMAIL_RE.test(to)) {
          await Task.findOneAndUpdate(
            { _id: task._id, organizationId: ctx!.organizationId },
            { $set: { emailSent: false } },
          )
          results.failed++
          results.errors.push(`Task ${task.title}: missing or invalid email address`)
          continue
        }

        const relatedInfo: string[] = []
        if (
          task.relatedFamilyId &&
          typeof task.relatedFamilyId === 'object' &&
          'name' in task.relatedFamilyId
        ) {
          relatedInfo.push(`Family: ${escapeHtml((task.relatedFamilyId as any).name)}`)
        }
        if (task.relatedMemberId && typeof task.relatedMemberId === 'object') {
          const member = task.relatedMemberId as any
          relatedInfo.push(`Member: ${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}`)
        }

        const safeSubject = `Task Due Today: ${String(task.title || '').replace(/[\r\n]+/g, ' ')}`
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">Task Due Today</h2>
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #2563eb;">${escapeHtml(task.title)}</h3>
                ${task.description ? `<p style="color: #666;">${escapeHtml(task.description)}</p>` : ''}
                <p><strong>Due Date:</strong> ${escapeHtml(new Date(task.dueDate).toLocaleDateString())}</p>
                <p><strong>Priority:</strong> <span style="text-transform: capitalize;">${escapeHtml(task.priority)}</span></p>
                ${relatedInfo.length > 0 ? `<p><strong>Related:</strong> ${relatedInfo.join(', ')}</p>` : ''}
                ${task.notes ? `<p><strong>Notes:</strong> ${escapeHtml(task.notes)}</p>` : ''}
              </div>
              <p style="color: #666; font-size: 14px;">This is an automated notification from Kasa Family Management System.</p>
            </div>
          `

        const familyId =
          task.relatedFamilyId &&
          typeof task.relatedFamilyId === 'object' &&
          '_id' in task.relatedFamilyId
            ? String((task.relatedFamilyId as { _id: unknown })._id)
            : null

        const sendResult = await sendEmail({
          organizationId: ctx!.organizationId,
          familyId,
          to,
          subject: safeSubject,
          html,
          kind: 'task-reminder',
          relatedResource: { type: 'task', id: String(task._id) },
          tracking: { opens: true, clicks: true },
          config: mailConfig,
          transporter,
        })

        if (!sendResult.ok) {
          throw new Error(sendResult.error || 'Send failed')
        }
        results.sent++
      } catch (error: any) {
        await Task.findOneAndUpdate(
          { _id: task._id, organizationId: ctx!.organizationId },
          { $set: { emailSent: false } },
        ).catch(() => {})
        console.error(`Error sending email for task ${task._id}:`, error)
        results.failed++
        results.errors.push(
          `Task ${task.title}: ${sanitizeStripeErrorMessage(error.message) || 'Send failed'}`,
        )
      }
    }

    return {
      data: {
        message: `Email notifications sent: ${results.sent} successful, ${results.failed} failed`,
        sent: results.sent,
        failed: results.failed,
        errors: sanitizeBatchErrors(results.errors),
      },
    }
  },
})
