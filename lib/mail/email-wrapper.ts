export interface WrapEmailHtmlOpts {
  orgName?: string
  logoDataUrl?: string | null
  unsubscribeUrl?: string | null
}

/** Wrap custom email HTML with optional org header, logo, and unsubscribe footer. */
export function wrapEmailHtml(innerHtml: string, opts: WrapEmailHtmlOpts = {}): string {
  const orgName = opts.orgName?.trim() || 'Kasa Family Management'
  const logo = opts.logoDataUrl?.trim()
  const logoBlock = logo
    ? `<img src="${logo}" alt="${escapeAttr(orgName)}" style="max-height:48px;max-width:200px;margin-bottom:12px;" />`
    : ''

  const unsubscribeBlock = opts.unsubscribeUrl
    ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280;">
        <a href="${escapeAttr(opts.unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a> from bulk emails from ${escapeHtml(orgName)}.
      </p>`
    : ''

  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:640px;margin:0 auto;">
  <div style="border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:20px;">
    ${logoBlock}
    <div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(orgName)}</div>
  </div>
  <div>${innerHtml}</div>
  ${unsubscribeBlock}
</div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}
