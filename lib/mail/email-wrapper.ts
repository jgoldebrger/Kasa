export interface OrgPhysicalAddress {
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  zip?: string
}

export interface WrapEmailHtmlOpts {
  orgName?: string
  logoDataUrl?: string | null
  unsubscribeUrl?: string | null
  physicalAddress?: OrgPhysicalAddress | null
}

function formatPhysicalAddress(addr: OrgPhysicalAddress): string | null {
  const lines: string[] = []
  const line1 = addr.addressLine1?.trim()
  const line2 = addr.addressLine2?.trim()
  if (line1) lines.push(line1)
  if (line2) lines.push(line2)

  const city = addr.city?.trim()
  const state = addr.state?.trim()
  const zip = addr.zip?.trim()
  const cityLine = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (cityLine) lines.push(cityLine)

  return lines.length > 0 ? lines.join('<br/>') : null
}

/** Wrap custom email HTML with optional org header, logo, and unsubscribe footer. */
export function wrapEmailHtml(innerHtml: string, opts: WrapEmailHtmlOpts = {}): string {
  const orgName = opts.orgName?.trim() || 'Kasa Family Management'
  const logo = opts.logoDataUrl?.trim()
  const logoBlock = logo
    ? `<img src="${logo}" alt="${escapeAttr(orgName)}" style="max-height:48px;max-width:200px;margin-bottom:12px;" />`
    : ''

  const addressHtml = opts.physicalAddress ? formatPhysicalAddress(opts.physicalAddress) : null

  const unsubscribeBlock = opts.unsubscribeUrl
    ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280;">
        <a href="${escapeAttr(opts.unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a> from bulk emails from ${escapeHtml(orgName)}.
      </p>`
    : ''

  const canSpamBlock =
    addressHtml || unsubscribeBlock
      ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5;">
        ${addressHtml ? `<div style="margin-bottom:8px;">${addressHtml}</div>` : ''}
        ${unsubscribeBlock}
      </div>`
      : ''

  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:640px;margin:0 auto;">
  <div style="border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:20px;">
    ${logoBlock}
    <div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(orgName)}</div>
  </div>
  <div>${innerHtml}</div>
  ${canSpamBlock}
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
