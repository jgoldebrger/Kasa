/**
 * Ops webhook for platform support-mode events.
 * Fire-and-forget POST when PLATFORM_SUPPORT_WEBHOOK_URL is set.
 */

export type SupportWebhookEvent = 'impersonate.start' | 'impersonate.end'

export interface SupportWebhookPayload {
  event: SupportWebhookEvent
  orgId: string
  orgName: string
  adminEmail: string
  reason?: string
  readOnly?: boolean
  scope?: string
  at: string
}

export function notifyPlatformSupportWebhook(payload: SupportWebhookPayload): void {
  const url = process.env.PLATFORM_SUPPORT_WEBHOOK_URL?.trim()
  if (!url) return

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err: unknown) => {
    console.error(
      '[platform-support-webhook] POST failed:',
      err instanceof Error ? err.message : err,
    )
  })
}
