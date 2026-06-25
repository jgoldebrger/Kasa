export function isSmsConfigured(): false {
  return false
}

export function sendSms(): { ok: false; error: 'SMS not configured' } {
  return { ok: false, error: 'SMS not configured' }
}
