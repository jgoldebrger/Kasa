/** Client-safe platform admin constants (no server/DB imports). */

export const PLATFORM_ADMIN_2FA_REQUIRED_CODE = 'PLATFORM_ADMIN_2FA_REQUIRED'

export const PLATFORM_ADMIN_2FA_REQUIRED_MESSAGE =
  'Two-factor authentication is required for platform admin access. Enable 2FA in your account settings at /account.'

/** Step-up TOTP required before sensitive platform-admin mutations. */
export const PLATFORM_ADMIN_TOTP_REVERIFY_CODE = 'PLATFORM_ADMIN_TOTP_REVERIFY_REQUIRED'

export const PLATFORM_ADMIN_TOTP_REVERIFY_MESSAGE =
  'Enter your authenticator code to confirm this sensitive platform admin action.'
